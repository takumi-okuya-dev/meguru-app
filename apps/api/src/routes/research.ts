// /api/accounts/:accountId/reference-posts と /research-keywords（specs/002-strategy-profile contracts/api.md）
import {
  KEYWORD_LIMIT,
  REFERENCE_POST_LIMIT,
  normalizeKeyword,
  referencePostInputSchema,
  researchKeywordInputSchema,
  updateReferencePostRequestSchema,
  updateResearchKeywordRequestSchema,
  type ReferencePostInput,
} from "@threads-grower/shared";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { referencePosts, researchKeywords } from "../db/schema";
import { AppError, pgErrorCode } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { authorizeAccount } from "../services/access";
import { recordActivity, updatedByOf, withActivityTx } from "../services/activity-log";
import { touchMaterials } from "../services/materials";
import { assertItemId, insertWithLimit, updateWithVersion } from "../services/item-service";

type ReferencePostRow = typeof referencePosts.$inferSelect;
type KeywordRow = typeof researchKeywords.$inferSelect;

const orNull = (s: string) => (s.trim() === "" ? null : s);

/**
 * 参考投稿の行を、レスポンスの形にする。任意のテキストの NULL は "" にする。
 * @param row - reference_posts の行
 * @returns レスポンスの参考投稿
 */
function toReferencePost(row: ReferencePostRow) {
  return {
    id: row.id,
    body: row.body,
    keyword: row.keyword ?? "",
    postUrl: row.postUrl ?? "",
    whyGood: row.whyGood ?? "",
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * キーワードの行を、レスポンスの形にする。
 * @param row - research_keywords の行
 * @returns レスポンスのキーワード
 */
function toKeyword(row: KeywordRow) {
  return {
    id: row.id,
    keyword: row.keyword,
    purpose: row.purpose ?? "",
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const referenceColumns = (input: ReferencePostInput) => ({
  body: input.body,
  keyword: orNull(input.keyword),
  postUrl: orNull(input.postUrl),
  whyGood: orNull(input.whyGood),
});

/**
 * 一意制約の違反（同じキーワード）を 409 KEYWORD_DUPLICATE にする（research.md R5）。
 * @param fn - キーワードを書き込む処理
 * @returns fn の戻り値
 */
async function withDuplicateCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgErrorCode(err) === "23505") throw new AppError("KEYWORD_DUPLICATE", 409, "duplicate keyword");
    throw err;
  }
}

/**
 * 参考投稿とキーワードのルート。書き込みは「所有 → grower機能 → 入力の検証」の順で確かめる。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function researchRoutes(authed: MiddlewareHandler<AppEnv>) {
  return (
    new Hono<AppEnv>()
      // ---- 参考投稿 ----
      .get("/accounts/:accountId/reference-posts", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "read");
        const account = access.account;
        const rows = await db
          .select()
          .from(referencePosts)
          .where(eq(referencePosts.accountId, account.id))
          .orderBy(desc(referencePosts.createdAt), desc(referencePosts.id));
        // 直せるのは content の権限がある人だけ（見せてもらっている人は読むだけ。PR #14 のCodexレビュー）
        return c.json({ items: rows.map(toReferencePost), limit: REFERENCE_POST_LIMIT, canEdit: access.permissions.has("content") });
      })
      .post("/accounts/:accountId/reference-posts", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
        const account = access.account;
        const input = await parseBody(referencePostInputSchema, c.req.json());
        const row = await insertWithLimit(
          c.env,
          account.id,
          "reference_posts",
          REFERENCE_POST_LIMIT,
          async (tx) =>
            (await tx.select({ n: count() }).from(referencePosts).where(eq(referencePosts.accountId, account.id)))[0]!.n,
          async (tx) => {
            const [inserted] = await tx
              .insert(referencePosts)
              .values({ accountId: account.id, ...referenceColumns(input), updatedByUserId: access.actor.id })
              .returning();
            // 追加と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
            await recordActivity(tx, access, { kind: "content", action: "reference_post_added", excerpts: [inserted!.body] });
            return inserted!;
          },
        );
        await touchMaterials(db, account.id, "research");
        return c.json(toReferencePost(row), 201);
      })
      .put("/accounts/:accountId/reference-posts/:referencePostId", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
        const account = access.account;
        const id = assertItemId(c.req.param("referencePostId"));
        const { expectedVersion, ...input } = await parseBody(updateReferencePostRequestSchema, c.req.json());
        const where = and(eq(referencePosts.id, id), eq(referencePosts.accountId, account.id));
        // 保存と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
        const row = await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
          const updated = await updateWithVersion(
            () =>
              q
                .update(referencePosts)
                .set({
                  ...referenceColumns(input),
                  updatedByUserId: access.actor.id,
                  version: sql`${referencePosts.version} + 1`,
                  updatedAt: new Date(),
                })
                .where(and(where, eq(referencePosts.version, expectedVersion)))
                .returning(),
            async () => (await q.select().from(referencePosts).where(where).limit(1))[0],
            toReferencePost,
            (current) => updatedByOf(q, current.updatedByUserId),
          );
          await recordActivity(q, access, { kind: "content", action: "reference_post_updated", excerpts: [updated.body] });
          return updated;
        });
        await touchMaterials(db, account.id, "research");
        return c.json(toReferencePost(row));
      })
      .delete("/accounts/:accountId/reference-posts/:referencePostId", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
        const account = access.account;
        const id = assertItemId(c.req.param("referencePostId"));
        // 削除と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
        await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
          const removed = await q
            .delete(referencePosts)
            .where(and(eq(referencePosts.id, id), eq(referencePosts.accountId, account.id)))
            .returning();
          if (removed[0]) {
            await recordActivity(q, access, { kind: "content", action: "reference_post_deleted", excerpts: [removed[0].body] });
          }
        });
        await touchMaterials(db, account.id, "research");
        return c.body(null, 204);
      })
      // ---- キーワード ----
      .get("/accounts/:accountId/research-keywords", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "read");
        const account = access.account;
        const rows = await db
          .select()
          .from(researchKeywords)
          .where(eq(researchKeywords.accountId, account.id))
          .orderBy(desc(researchKeywords.createdAt), desc(researchKeywords.id));
        // 直せるのは content の権限がある人だけ（PR #14 のCodexレビュー）
        return c.json({ items: rows.map(toKeyword), limit: KEYWORD_LIMIT, canEdit: access.permissions.has("content") });
      })
      .post("/accounts/:accountId/research-keywords", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
        const account = access.account;
        const input = await parseBody(researchKeywordInputSchema, c.req.json());
        const row = await withDuplicateCheck(() =>
          insertWithLimit(
            c.env,
            account.id,
            "research_keywords",
            KEYWORD_LIMIT,
            async (tx) =>
              (await tx.select({ n: count() }).from(researchKeywords).where(eq(researchKeywords.accountId, account.id)))[0]!.n,
            async (tx) => {
              const [inserted] = await tx
                .insert(researchKeywords)
                .values({
                  accountId: account.id,
                  keyword: input.keyword,
                  keywordNormalized: normalizeKeyword(input.keyword),
                  purpose: orNull(input.purpose),
                  updatedByUserId: access.actor.id,
                })
                .returning();
              // 追加と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
              await recordActivity(tx, access, { kind: "content", action: "research_keyword_added", summary: inserted!.keyword });
              return inserted!;
            },
          ),
        );
        await touchMaterials(db, account.id, "research");
        return c.json(toKeyword(row), 201);
      })
      .put("/accounts/:accountId/research-keywords/:keywordId", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
        const account = access.account;
        const id = assertItemId(c.req.param("keywordId"));
        const { expectedVersion, ...input } = await parseBody(updateResearchKeywordRequestSchema, c.req.json());
        const where = and(eq(researchKeywords.id, id), eq(researchKeywords.accountId, account.id));
        // 保存と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
        const row = await withDuplicateCheck(() =>
          withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
            const updated = await updateWithVersion(
              () =>
                q
                  .update(researchKeywords)
                  .set({
                    keyword: input.keyword,
                    keywordNormalized: normalizeKeyword(input.keyword),
                    purpose: orNull(input.purpose),
                    updatedByUserId: access.actor.id,
                    version: sql`${researchKeywords.version} + 1`,
                    updatedAt: new Date(),
                  })
                  .where(and(where, eq(researchKeywords.version, expectedVersion)))
                  .returning(),
              async () => (await q.select().from(researchKeywords).where(where).limit(1))[0],
              toKeyword,
              (current) => updatedByOf(q, current.updatedByUserId),
            );
            await recordActivity(q, access, { kind: "content", action: "research_keyword_updated", summary: updated.keyword });
            return updated;
          }),
        );
        await touchMaterials(db, account.id, "research");
        return c.json(toKeyword(row));
      })
      .delete("/accounts/:accountId/research-keywords/:keywordId", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
        const account = access.account;
        const id = assertItemId(c.req.param("keywordId"));
        // 削除と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
        await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
          const removed = await q
            .delete(researchKeywords)
            .where(and(eq(researchKeywords.id, id), eq(researchKeywords.accountId, account.id)))
            .returning();
          if (removed[0]) {
            await recordActivity(q, access, { kind: "content", action: "research_keyword_deleted", summary: removed[0].keyword });
          }
        });
        await touchMaterials(db, account.id, "research");
        return c.body(null, 204);
      })
  );
}

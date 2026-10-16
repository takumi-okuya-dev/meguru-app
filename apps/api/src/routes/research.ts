// /api/accounts/:accountId/reference-posts と /research-keywords（specs/002-strategy-profile contracts/api.md）
import {
  EXPLAIN_BATCH_MAX,
  KEYWORD_LIMIT,
  REFERENCE_POST_LIMIT,
  buildExplainPrompt,
  explanationsRequestSchema,
  freshnessOf,
  isBlank,
  sortForPrompt,
  jstToday,
  normalizeKeyword,
  referencePostBatchRequestSchema,
  referencePostInputSchema,
  shortIdsOf,
  researchKeywordInputSchema,
  updateReferencePostRequestSchema,
  updateResearchKeywordRequestSchema,
  type ReferencePost,
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
import { getStrategy } from "../services/strategy-service";
import { assertItemId, insertManyWithLimit, insertWithLimit, updateWithVersion } from "../services/item-service";

type ReferencePostRow = typeof referencePosts.$inferSelect;
type KeywordRow = typeof researchKeywords.$inferSelect;

const orNull = (s: string) => (s.trim() === "" ? null : s);

/**
 * 参考投稿の行を、レスポンスの形にする。任意のテキストの NULL は "" にする。
 * @param row - reference_posts の行
 * @returns レスポンスの参考投稿
 */
/**
 * 参考投稿の行を応答の形にする。鮮度は今日（日本時間）で求める（specs/014 R6）。
 * @param row - 参考投稿の行
 * @param shortId - まとめての解説で使う短いID（一覧では重なりを見て延ばしたもの。省略は先頭8文字）
 * @returns 応答の参考投稿
 */
function toReferencePost(row: ReferencePostRow, shortId?: string) {
  const postedDateMode = row.postedDateMode as ReferencePost["postedDateMode"];
  return {
    id: row.id,
    body: row.body,
    keyword: row.keyword ?? "",
    postUrl: row.postUrl ?? "",
    whyGood: row.whyGood ?? "",
    platform: row.platform as ReferencePost["platform"],
    postedDateMode,
    postedDate: row.postedDate,
    metrics: {
      likes: row.metricLikes,
      replies: row.metricReplies,
      views: row.metricViews,
      saves: row.metricSaves,
      reposts: row.metricReposts,
      followers: row.metricFollowers,
    },
    author: row.author ?? "",
    memo: row.memo ?? "",
    freshness: freshnessOf({ postedDateMode, postedDate: row.postedDate, createdAt: row.createdAt }, jstToday(new Date())),
    shortId: shortId ?? row.id.replace(/-/g, "").slice(0, 8),
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
  platform: input.platform,
  postedDateMode: input.postedDateMode,
  postedDate: input.postedDateMode === "exact" ? input.postedDate : null,
  metricLikes: input.metrics.likes,
  metricReplies: input.metrics.replies,
  metricViews: input.metrics.views,
  metricSaves: input.metrics.saves,
  metricReposts: input.metrics.reposts,
  metricFollowers: input.metrics.followers,
  author: orNull(input.author),
  memo: orNull(input.memo),
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
        // 短いIDは、アカウントの中で重ならない長さにする（specs/014 FR-102）
        const shortIds = shortIdsOf(rows.map((r) => r.id));
        // 直せるのは content の権限がある人だけ（見せてもらっている人は読むだけ。PR #14 のCodexレビュー）
        return c.json({
          items: rows.map((r) => toReferencePost(r, shortIds.get(r.id))),
          limit: REFERENCE_POST_LIMIT,
          canEdit: access.permissions.has("content"),
        });
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
      // ためた参考投稿をまとめて登録する（specs/014 FR-083・FR-084、research.md R7）。全部か無しか
      .post("/accounts/:accountId/reference-posts/batch", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const user = c.get("user");
        const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
        const account = access.account;
        const parsed = referencePostBatchRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          // どの投稿のどの項目かがわかるように、位置つきの項目名を返す（items.2.body など）
          const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")).filter(Boolean))];
          throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, fields);
        }
        const { items } = parsed.data;
        const rows = await insertManyWithLimit(
          c.env,
          account.id,
          "reference_posts",
          REFERENCE_POST_LIMIT,
          async (tx) =>
            (await tx.select({ n: count() }).from(referencePosts).where(eq(referencePosts.accountId, account.id)))[0]!.n,
          items.length,
          async (tx) => {
            // 送った順を保つため、登録日時を1ミリ秒ずつずらす（一覧は新しい順なので、後に送ったものが上）
            const base = Date.now();
            const inserted = await tx
              .insert(referencePosts)
              .values(
                items.map((input, i) => ({
                  accountId: account.id,
                  ...referenceColumns(input),
                  updatedByUserId: access.actor.id,
                  createdAt: new Date(base + i),
                  updatedAt: new Date(base + i),
                })),
              )
              .returning();
            await recordActivity(tx, access, {
              kind: "content",
              action: "reference_posts_added",
              summary: `${items.length}件`,
              excerpts: [items[0]!.body],
            });
            return inserted;
          },
        );
        await touchMaterials(db, account.id, "research");
        return c.json({ items: rows.map((r) => toReferencePost(r)) }, 201);
      })
      // 解説のプロンプト（specs/014 FR-086・FR-100・FR-101、research.md R8）。?id= で1件、なしで解説がまだのものをまとめて
      .get("/accounts/:accountId/reference-posts/explain-prompt", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "content");
        const account = access.account;
        const [rows, strategy] = await Promise.all([
          db.select().from(referencePosts).where(eq(referencePosts.accountId, account.id)),
          getStrategy(db, account.id),
        ]);
        const shortIds = shortIdsOf(rows.map((r) => r.id));
        const toSource = (r: ReferencePostRow) => toReferencePost(r, shortIds.get(r.id));
        const pending = rows.filter((r) => isBlank(r.whyGood ?? ""));
        const id = c.req.query("id");
        let chosen: ReturnType<typeof toSource>[];
        if (id !== undefined) {
          const row = rows.find((r) => r.id === assertItemId(id));
          if (!row) throw new AppError("ITEM_NOT_FOUND", 404, "item not found");
          chosen = [toSource(row)];
        } else {
          chosen = sortForPrompt(pending.map(toSource), jstToday(new Date())).slice(0, EXPLAIN_BATCH_MAX);
        }
        return c.json({
          prompt: chosen.length === 0 ? "" : buildExplainPrompt(chosen, strategy, { batch: id === undefined }),
          items: chosen.map((p) => ({ id: p.id, shortId: p.shortId })),
          pendingCount: pending.length,
        });
      })
      // まとめての解説の保存（specs/014 FR-104、research.md R8）。解説が空の行だけを更新し、ほかは飛ばす
      .post("/accounts/:accountId/reference-posts/explanations", authed, async (c) => {
        const db = createDb(c.env.DATABASE_URL);
        const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "content");
        const account = access.account;
        const { items } = await parseBody(explanationsRequestSchema, c.req.json());
        const result = await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
          const saved: string[] = [];
          const skipped: { id: string; reason: "already_explained" | "not_found" }[] = [];
          for (const item of items) {
            const updated = await q
              .update(referencePosts)
              .set({
                whyGood: item.whyGood.trim(),
                updatedByUserId: access.actor.id,
                version: sql`${referencePosts.version} + 1`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(referencePosts.id, item.id),
                  eq(referencePosts.accountId, account.id),
                  sql`(${referencePosts.whyGood} IS NULL OR btrim(${referencePosts.whyGood}) = '')`,
                ),
              )
              .returning();
            if (updated.length > 0) {
              saved.push(item.id);
              continue;
            }
            const exists = await q
              .select({ id: referencePosts.id })
              .from(referencePosts)
              .where(and(eq(referencePosts.id, item.id), eq(referencePosts.accountId, account.id)))
              .limit(1);
            skipped.push({ id: item.id, reason: exists.length > 0 ? "already_explained" : "not_found" });
          }
          if (saved.length > 0) {
            await recordActivity(q, access, { kind: "content", action: "reference_posts_explained", summary: `${saved.length}件` });
          }
          return { saved, skipped };
        });
        if (result.saved.length > 0) await touchMaterials(db, account.id, "research");
        return c.json(result);
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

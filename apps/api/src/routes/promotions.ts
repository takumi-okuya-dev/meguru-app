// /api/accounts/:accountId/promotions と /promotion-settings（specs/002-strategy-profile contracts/api.md）
import {
  PROMOTION_LIMIT,
  isExpired,
  isTargetable,
  promotionInputSchema,
  putPromotionSettingsRequestSchema,
  sortPromotions,
  updatePromotionRequestSchema,
  type PromotionInput,
} from "@threads-grower/shared";
import { and, count, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb, type Db, type TxDb } from "../db/client";
import { accounts, promotions } from "../db/schema";
import { AppError, notFound } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { authorizeAccount } from "../services/access";
import { recordActivity, updatedByOf, withActivityTx } from "../services/activity-log";
import { touchMaterials } from "../services/materials";
import { canEditProfile, requireGrowerAccess } from "../services/grower-access";
import { assertItemId, insertWithLimit, updateWithVersion } from "../services/item-service";

type PromotionRow = typeof promotions.$inferSelect;

/**
 * 宣伝内容の行を、レスポンスの形にする。任意のテキストの NULL は "" にする。
 * @param row - promotions の行
 * @param now - 現在時刻（期限切れの判定に使う）
 * @returns レスポンスの宣伝内容
 */
function toPromotion(row: PromotionRow, now: Date) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    targetLocation: row.targetLocation ?? "",
    targetPersona: row.targetPersona ?? "",
    targetAgeRange: row.targetAgeRange ?? "",
    cta: row.cta ?? "",
    linkedUrl: row.linkedUrl ?? "",
    priority: row.priority,
    status: row.status,
    validUntil: row.validUntil,
    isExpired: isExpired(row.validUntil, now),
    isTargetable: isTargetable(row.status, row.validUntil, now),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 入力を列の値にする。任意のテキストの "" は NULL にする。
 * @param input - 検証済みの入力
 * @returns 列の値
 */
function toColumns(input: PromotionInput) {
  const orNull = (s: string) => (s.trim() === "" ? null : s);
  return {
    title: input.title,
    content: input.content,
    targetLocation: orNull(input.targetLocation),
    targetPersona: orNull(input.targetPersona),
    targetAgeRange: orNull(input.targetAgeRange),
    cta: orNull(input.cta),
    linkedUrl: orNull(input.linkedUrl),
    priority: input.priority,
    status: input.status,
    validUntil: input.validUntil,
  };
}

async function findPromotion(db: Db | TxDb, accountId: string, id: string) {
  const [row] = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.id, id), eq(promotions.accountId, accountId)))
    .limit(1);
  return row;
}

/**
 * 宣伝内容と宣伝投稿の割合のルート。書き込みは「所有 → grower機能 → 入力の検証」の順で確かめる。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function promotionRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/promotion-settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      const account = access.account;
      return c.json({
        ratioPercent: account.promotionRatioPercent,
        version: account.promotionRatioVersion,
        canEdit: canEditProfile(account, access.owner),
      });
    })
    .put("/accounts/:accountId/promotion-settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const { ratioPercent, expectedVersion } = await parseBody(putPromotionSettingsRequestSchema, c.req.json());
      // 読み込んだときの版が一致するときだけ保存する（黙って上書きしない。specs/008 FR-007、PR #9 のCodexレビュー）。
      // 保存と操作の記録は同じトランザクションにする
      const saved = await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
        const [row] = await q
          .update(accounts)
          .set({
            promotionRatioPercent: ratioPercent,
            promotionRatioVersion: sql`${accounts.promotionRatioVersion} + 1`,
            promotionRatioUpdatedByUserId: access.actor.id,
            updatedAt: new Date(),
          })
          .where(and(eq(accounts.id, account.id), eq(accounts.promotionRatioVersion, expectedVersion)))
          .returning();
        if (row) await recordActivity(q, access, { kind: "content", action: "promotion_ratio_saved", summary: `${ratioPercent}%` });
        return row;
      });
      if (!saved) {
        const [current] = await db.select().from(accounts).where(eq(accounts.id, account.id)).limit(1);
        if (!current) throw notFound();
        throw new AppError(
          "STALE_UPDATE",
          409,
          "updated elsewhere",
          { ratioPercent: current.promotionRatioPercent, version: current.promotionRatioVersion, canEdit: true },
          undefined,
          { updatedBy: await updatedByOf(db, current.promotionRatioUpdatedByUserId) },
        );
      }
      return c.json({ ratioPercent: saved.promotionRatioPercent, version: saved.promotionRatioVersion, canEdit: true });
    })
    .get("/accounts/:accountId/promotions", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      const account = access.account;
      const now = new Date();
      const rows = await db.select().from(promotions).where(eq(promotions.accountId, account.id));
      return c.json({
        items: sortPromotions(rows.map((r) => toPromotion(r, now)), now),
        limit: PROMOTION_LIMIT,
        canEdit: canEditProfile(account, access.owner, now),
      });
    })
    .post("/accounts/:accountId/promotions", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const input = await parseBody(promotionInputSchema, c.req.json());
      const row = await insertWithLimit(
        c.env,
        account.id,
        "promotions",
        PROMOTION_LIMIT,
        async (tx) => (await tx.select({ n: count() }).from(promotions).where(eq(promotions.accountId, account.id)))[0]!.n,
        async (tx) => {
          const [inserted] = await tx
            .insert(promotions)
            .values({ accountId: account.id, ...toColumns(input), updatedByUserId: access.actor.id })
            .returning();
          await recordActivity(tx, access, { kind: "content", action: "promotion_added", summary: inserted!.title });
          return inserted!;
        },
      );
      await touchMaterials(db, account.id, "promotions");
      return c.json(toPromotion(row, new Date()), 201);
    })
    .put("/accounts/:accountId/promotions/:promotionId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const id = assertItemId(c.req.param("promotionId"));
      const { expectedVersion, ...input } = await parseBody(updatePromotionRequestSchema, c.req.json());
      const now = new Date();
      // 保存と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
      const row = await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
        const updated = await updateWithVersion(
          () =>
            q
              .update(promotions)
              .set({ ...toColumns(input), updatedByUserId: access.actor.id, version: sql`${promotions.version} + 1`, updatedAt: now })
              .where(and(eq(promotions.id, id), eq(promotions.accountId, account.id), eq(promotions.version, expectedVersion)))
              .returning(),
          () => findPromotion(q, account.id, id),
          (current) => toPromotion(current, now),
          (current) => updatedByOf(q, current.updatedByUserId),
        );
        await recordActivity(q, access, { kind: "content", action: "promotion_updated", summary: updated.title });
        return updated;
      });
      await touchMaterials(db, account.id, "promotions");
      return c.json(toPromotion(row, now));
    })
    .delete("/accounts/:accountId/promotions/:promotionId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const id = assertItemId(c.req.param("promotionId"));
      // すでに消えていても成功とする（contracts/api.md）
      // 削除と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
      await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
        const removed = await q
          .delete(promotions)
          .where(and(eq(promotions.id, id), eq(promotions.accountId, account.id)))
          .returning();
        if (removed[0]) await recordActivity(q, access, { kind: "content", action: "promotion_deleted", summary: removed[0].title });
      });
      await touchMaterials(db, account.id, "promotions");
      return c.body(null, 204);
    });
}

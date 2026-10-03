// /api/accounts/:accountId/promotions と /promotion-settings（specs/002-strategy-profile contracts/api.md）
import {
  PROMOTION_LIMIT,
  invalidFields,
  isExpired,
  isTargetable,
  promotionInputSchema,
  promotionSettingsInputSchema,
  sortPromotions,
  updatePromotionRequestSchema,
  type PromotionInput,
} from "@threads-grower/shared";
import { and, count, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../app";
import { createDb, type Db } from "../db/client";
import { accounts, promotions } from "../db/schema";
import { AppError } from "../lib/errors";
import { findOwnedAccount } from "../services/access";
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

/**
 * リクエストの本文を検証する。違反は 400 VALIDATION_FAILED（details に項目名）。
 * @param schema - zod のスキーマ
 * @param body - リクエストの本文
 * @returns 検証済みの値
 */
async function parseBody<S extends z.ZodTypeAny>(schema: S, body: Promise<unknown>): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await body.catch(() => null));
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, invalidFields(parsed.error));
  return parsed.data;
}

async function findPromotion(db: Db, accountId: string, id: string) {
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
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      return c.json({ ratioPercent: account.promotionRatioPercent, canEdit: canEditProfile(account, user) });
    })
    .put("/accounts/:accountId/promotion-settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      requireGrowerAccess(account, user);
      const { ratioPercent } = await parseBody(promotionSettingsInputSchema, c.req.json());
      // 競合は検知しない（後勝ち。research.md R7）
      await db.update(accounts).set({ promotionRatioPercent: ratioPercent, updatedAt: new Date() }).where(eq(accounts.id, account.id));
      return c.json({ ratioPercent, canEdit: true });
    })
    .get("/accounts/:accountId/promotions", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      const now = new Date();
      const rows = await db.select().from(promotions).where(eq(promotions.accountId, account.id));
      return c.json({
        items: sortPromotions(rows.map((r) => toPromotion(r, now)), now),
        limit: PROMOTION_LIMIT,
        canEdit: canEditProfile(account, user, now),
      });
    })
    .post("/accounts/:accountId/promotions", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      requireGrowerAccess(account, user);
      const input = await parseBody(promotionInputSchema, c.req.json());
      const row = await insertWithLimit(
        c.env,
        account.id,
        "promotions",
        PROMOTION_LIMIT,
        async (tx) => (await tx.select({ n: count() }).from(promotions).where(eq(promotions.accountId, account.id)))[0]!.n,
        async (tx) => (await tx.insert(promotions).values({ accountId: account.id, ...toColumns(input) }).returning())[0]!,
      );
      return c.json(toPromotion(row, new Date()), 201);
    })
    .put("/accounts/:accountId/promotions/:promotionId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      requireGrowerAccess(account, user);
      const id = assertItemId(c.req.param("promotionId"));
      const { expectedVersion, ...input } = await parseBody(updatePromotionRequestSchema, c.req.json());
      const now = new Date();
      const row = await updateWithVersion(
        () =>
          db
            .update(promotions)
            .set({ ...toColumns(input), version: sql`${promotions.version} + 1`, updatedAt: now })
            .where(and(eq(promotions.id, id), eq(promotions.accountId, account.id), eq(promotions.version, expectedVersion)))
            .returning(),
        () => findPromotion(db, account.id, id),
        (current) => toPromotion(current, now),
      );
      return c.json(toPromotion(row, now));
    })
    .delete("/accounts/:accountId/promotions/:promotionId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      requireGrowerAccess(account, user);
      const id = assertItemId(c.req.param("promotionId"));
      // すでに消えていても成功とする（contracts/api.md）
      await db.delete(promotions).where(and(eq(promotions.id, id), eq(promotions.accountId, account.id)));
      return c.body(null, 204);
    });
}

// /api/accounts/:accountId/strategy（specs/002-strategy-profile contracts/api.md）
import { invalidFields, putStrategyRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { authorizeAccount } from "../services/access";
import { canEditProfile, requireGrowerAccess } from "../services/grower-access";
import { getProfileStatus } from "../services/profile-status";
import { getStrategy, saveStrategy } from "../services/strategy-service";

/**
 * 課題とホームの入力状況のルート。GET は誰でも（owner なら）読め、PUT は grower機能を使える場合だけ保存できる。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function strategyRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/profile-status", authed, async (c) => {
      // ホームの入力状況（FR-017）。読み取りなので grower機能の判定はしない
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      const account = access.account;
      return c.json(await getProfileStatus(db, account, access.owner));
    })
    .get("/accounts/:accountId/strategy", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      const account = access.account;
      return c.json({ ...(await getStrategy(db, account.id)), canEdit: canEditProfile(account, access.owner) });
    })
    .put("/accounts/:accountId/strategy", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      // 必ず「所有 → grower機能 → 入力の検証」の順で確かめる（FR-023・FR-024）
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const parsed = putStrategyRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError("VALIDATION_FAILED", 400, "invalid strategy", undefined, invalidFields(parsed.error));
      }
      return c.json({ ...(await saveStrategy(db, account.id, parsed.data, access)), canEdit: true });
    });
}

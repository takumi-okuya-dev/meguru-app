// /api/accounts/:accountId/strategy（specs/002-strategy-profile contracts/api.md）
import { invalidFields, putStrategyRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../kernel/db/client";
import { withActivityTx } from "../services/activity-log";
import { AppError } from "../kernel/errors";
import { authorizeAccount } from "../services/access";
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
      // 機能のまとまりでは守らない（ホームが使う数だけで、中身は返さない。specs/019 research.md R3）
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      return c.json(await getProfileStatus(db, access, user.billing));
    })
    .get("/accounts/:accountId/strategy", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "read", { feature: "strategy" });
      const account = access.account;
      // 直せるのは content の権限がある人だけ（見せてもらっている人は読むだけ。PR #14 のCodexレビュー）
      return c.json({
        ...(await getStrategy(db, account.id)),
        canEdit: access.permissions.has("content"),
      });
    })
    .put("/accounts/:accountId/strategy", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      // 必ず「所有 → grower機能 → 入力の検証」の順で確かめる（FR-023・FR-024）
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content", { feature: "strategy" });
      const account = access.account;
      const parsed = putStrategyRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError("VALIDATION_FAILED", 400, "invalid strategy", undefined, invalidFields(parsed.error));
      }
      // 保存と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
      const saved = await withActivityTx(c.env.DATABASE_URL, db, access, (q) => saveStrategy(q, account.id, parsed.data, access));
      return c.json({ ...saved, canEdit: true });
    });
}

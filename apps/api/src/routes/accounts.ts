// /api/accounts/*（contracts/api.md）
import { deleteAccountRequestSchema, openAccountRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { createThreadsClient } from "../lib/threads-client";
import { authorizeAccount, toAccountSummary, type AccountAccess } from "../services/access";
import { deleteAccount, openAccount, verifyConnection } from "../services/account-service";

/**
 * 判定の結果を、ログインした人から見た AccountSummary にする（specs/008 research.md R11）。
 * @param access - authorizeAccount の結果
 * @returns AccountSummary
 */
function summaryOf(access: AccountAccess) {
  return toAccountSummary(access.account, access.role, access.role === "owner" ? null : access.owner.name);
}

/**
 * /api/accounts/* のルート。取得・open（記録と接続の確認）・削除。
 * いずれも「権限 → 入力の検証」の順で確かめる（specs/008 contracts/permissions.md）。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function accountRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId", authed, async (c) => {
      // 副作用なし：DBに保存されている状態のまま返す
      const access = await authorizeAccount(createDb(c.env.DATABASE_URL), c.get("user"), c.req.param("accountId"), "view");
      return c.json(summaryOf(access));
    })
    .post("/accounts/:accountId/open", authed, async (c) => {
      // ページをまたいで比べられる順序値として、受け取った時点のサーバー時刻を使う（research.md R10）
      const receivedAt = new Date();
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      const parsed = openAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid open request");
      await openAccount(c.env, user.id, access.account.id, parsed.data, receivedAt, access.role === "owner");
      await verifyConnection(c.env, access.account.id, createThreadsClient(c.env));
      return c.json(summaryOf(await authorizeAccount(db, user, access.account.id, "view")));
    })
    .delete("/accounts/:accountId", authed, async (c) => {
      const user = c.get("user");
      await authorizeAccount(createDb(c.env.DATABASE_URL), user, c.req.param("accountId"), "owner");
      const parsed = deleteAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid delete request");
      await deleteAccount(c.env, user.id, c.req.param("accountId"), parsed.data.confirmUsername);
      return c.body(null, 204);
    });
}

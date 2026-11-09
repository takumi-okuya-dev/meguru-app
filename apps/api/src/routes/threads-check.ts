// /api/accounts/:accountId/threads-check（「接続を確かめる」。specs/005-auto-post FR-002b、research.md R15）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../kernel/db/client";
import { createThreadsClient } from "../adapters/threads-api";
import { authorizeAccount } from "../services/access";
import { recordActivity } from "../services/activity-log";
import { checkThreadsPublish } from "../services/threads-check-service";

/**
 * 「接続を確かめる」のルート。投稿はしない。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function threadsCheckRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().post("/accounts/:accountId/threads-check", authed, async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings");
    const account = access.account;
    const result = await checkThreadsPublish(c.env, db, account.id, createThreadsClient(c.env));
    await recordActivity(db, access, { kind: "settings", action: "threads_checked", summary: result.status });
    return c.json(result);
  });
}

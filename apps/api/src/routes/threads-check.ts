// /api/accounts/:accountId/threads-check（「接続を確かめる」。specs/005-auto-post FR-002b、research.md R15）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { createThreadsClient } from "../lib/threads-client";
import { findOwnedAccount } from "../services/access";
import { checkThreadsPublish } from "../services/threads-check-service";

/**
 * 「接続を確かめる」のルート。投稿はしない。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function threadsCheckRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().post("/accounts/:accountId/threads-check", authed, async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
    return c.json(await checkThreadsPublish(c.env, db, account.id, createThreadsClient(c.env)));
  });
}

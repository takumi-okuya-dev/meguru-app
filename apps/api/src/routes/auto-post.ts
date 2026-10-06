// /api/accounts/:accountId/auto-post（自動投稿の状態と知らせ。specs/005-auto-post FR-018・FR-022、contracts/api.md）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { postingSchedules } from "../db/schema";
import { findOwnedAccount } from "../services/access";
import { getAutoPostStatus } from "../services/auto-post-status";

/**
 * 自動投稿の状態と知らせのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function autoPostRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/auto-post", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      return c.json(await getAutoPostStatus(db, account));
    })
    .post("/accounts/:accountId/auto-post/notices/blocked/dismiss", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      const now = new Date();
      await db
        .insert(postingSchedules)
        .values({ accountId: account.id, blockedNoticeSeenAt: now })
        .onConflictDoUpdate({
          target: postingSchedules.accountId,
          set: { blockedNoticeSeenAt: now, updatedAt: now },
        });
      return c.body(null, 204);
    });
}

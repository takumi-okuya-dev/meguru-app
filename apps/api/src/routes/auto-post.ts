// /api/accounts/:accountId/auto-post（自動投稿の状態と知らせ。specs/005-auto-post FR-018・FR-022、contracts/api.md）。
import { sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { postingSchedules } from "../db/schema";
import { authorizeAccount } from "../services/access";
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
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view");
      // オーナーが読むだけなら、自動投稿は止まっている（specs/013 research.md R8）
      return c.json(await getAutoPostStatus(db, { ...access.account, ownerReadOnly: access.readOnly !== null }));
    })
    .post("/accounts/:accountId/auto-post/notices/blocked/dismiss", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "review");
      const account = access.account;
      // 時刻はDBの時計で入れる。Workers の Date は最後の入出力の時点で止まるので、
      // 直前に `blocked_at = now()` で止められた下書きより前の時刻になり、知らせが消えないことがある
      const now = sql`now()`;
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

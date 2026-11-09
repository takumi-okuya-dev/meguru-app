// GET /api/me/needs-review-counts（Threads：オーナーのアカウントごとの確かめ待ちの件数）。
// 027で routes/me.ts から分けた（投稿の案の数を数えるThreads専用の入口。docs/module-map.md 2-2）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../kernel/db/client";
import { countOwnedAccountNeedsReview } from "../services/account-review-counts";

/**
 * 確かめ待ちの件数のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function needsReviewCountRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/me/needs-review-counts", authed, async (c) => {
    const user = c.get("user");
    const counts = await countOwnedAccountNeedsReview(createDb(c.env.DATABASE_URL), user.id);
    c.header("Cache-Control", "no-store");
    return c.json({ counts });
  });
}

// 紹介リンク（specs/017-referral-links contracts/api.md）。
// GET /api/me/referral は本人の紹介リンクと人数、GET /api/referral-page は紹介リンクの画面の注意のための情報（認証なし）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { billingModeOf } from "../lib/config";
import { referralOf } from "../services/referral-service";

/**
 * 紹介リンクのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function referralRoutes(authed: MiddlewareHandler<AppEnv>) {
  return (
    new Hono<AppEnv>()
      .get("/me/referral", authed, async (c) => {
        c.header("Cache-Control", "no-store");
        return c.json(await referralOf(c.env, c.get("user").id));
      })
      // 紹介の文字列は受け取らない（持ち主がいるかを外から確かめられないようにする。research.md R5）
      .get("/referral-page", (c) => c.json({ testGroups: Boolean(billingModeOf(c.env).testGroups) }))
  );
}

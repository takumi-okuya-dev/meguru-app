// /api/test-invites/:token（specs/016-test-groups contracts/api.md「招待の確認と参加」）。
// 確認はログイン不要（ログインしていれば、その人が参加できるかも返す）。参加はログイン必須。
// テスト版に入れない人でも呼べる（認証のミドルウェアの TEST_ACCESS_ALLOWED）。OFFの環境では使えないリンクと同じ 404。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { billingModeOf } from "../lib/config";
import { joinTestGroup, previewTestInvite, testInviteInvalid } from "../services/test-group-service";

/**
 * グループの招待のルート。
 * @param authed - 認証のミドルウェア
 * @param maybeAuthed - ログインが任意の認証のミドルウェア
 * @returns Hono のルート
 */
export function testInviteRoutes(authed: MiddlewareHandler<AppEnv>, maybeAuthed: MiddlewareHandler<AppEnv>) {
  const enabledOnly: MiddlewareHandler<AppEnv> = async (_c, next) => {
    if (!billingModeOf(_c.env).testGroups) throw testInviteInvalid();
    await next();
  };
  return new Hono<AppEnv>()
    .get("/test-invites/:token", enabledOnly, maybeAuthed, async (c) => {
      const user = c.get("user") as { id: string } | undefined;
      c.header("Cache-Control", "no-store");
      return c.json(await previewTestInvite(c.env, c.req.param("token"), user ?? null));
    })
    .post("/test-invites/:token/join", enabledOnly, authed, async (c) => {
      return c.json(await joinTestGroup(c.env, c.get("user"), c.req.param("token")));
    });
}

// /api/test-invites/:token（specs/016-test-groups contracts/api.md「招待の確認と参加」）。
// 確認はログイン不要（ログインしていれば、その人が参加できるかも返す）。参加はログイン必須。
// テスト版に入れない人でも呼べる（認証のミドルウェアの TEST_ACCESS_ALLOWED）。招待制がOFFの環境（本番）でも使う
// （グループは機能の設定にだけ使い、料金なしは付けない。specs/019 FR-019、research.md R11）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { joinTestGroup, previewTestInvite } from "./test-group-service";

/**
 * グループの招待のルート。
 * @param authed - 認証のミドルウェア
 * @param maybeAuthed - ログインが任意の認証のミドルウェア
 * @returns Hono のルート
 */
export function testInviteRoutes(authed: MiddlewareHandler<AppEnv>, maybeAuthed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/test-invites/:token", maybeAuthed, async (c) => {
      const user = c.get("user") as { id: string } | undefined;
      c.header("Cache-Control", "no-store");
      return c.json(await previewTestInvite(c.env, c.req.param("token"), user ?? null));
    })
    .post("/test-invites/:token/join", authed, async (c) => {
      return c.json(await joinTestGroup(c.env, c.get("user"), c.req.param("token")));
    });
}

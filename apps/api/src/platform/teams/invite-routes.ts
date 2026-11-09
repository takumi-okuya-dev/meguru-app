// /api/invites/:token（specs/011-team-revision contracts/api.md「招待の確認と参加」）。
// 確認はログイン不要（ログインしていれば、その人が参加できるかと、選べるアカウントも返す）。参加はログイン必須。
import { inviteAcceptRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { parseBody } from "../../kernel/validate";
import { requireFeature } from "../access/access";
import { acceptTeamInvite, previewTeamInvite } from "./invite-service";

/**
 * 招待のルート。
 * @param authed - 認証のミドルウェア
 * @param maybeAuthed - ログインが任意の認証のミドルウェア
 * @returns Hono のルート
 */
export function inviteRoutes(authed: MiddlewareHandler<AppEnv>, maybeAuthed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/invites/:token", maybeAuthed, async (c) => {
      const user = c.get("user") as { id: string } | undefined;
      c.header("Cache-Control", "no-store");
      return c.json(await previewTeamInvite(c.env, c.req.param("token"), user ?? null));
    })
    .post("/invites/:token/accept", authed, async (c) => {
      // チームを使えない人は、招待から入れない（specs/019 FR-009）
      requireFeature(c.get("user"), "team");
      const req = await parseBody(inviteAcceptRequestSchema, c.req.json());
      return c.json(await acceptTeamInvite(c.env, c.get("user"), c.req.param("token"), req.accounts));
    });
}

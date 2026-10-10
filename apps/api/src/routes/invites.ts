// /api/invites/:token（specs/008-team-operations contracts/api.md「招待の確認と参加」、research.md R7）。
// 確認はログイン不要（ログインしていれば、その人が参加できるかも返す）。参加はログイン必須。
import { inviteAcceptRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { parseBody } from "../lib/validate";
import { acceptInvite, previewInvite } from "../services/invite-service";

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
      return c.json(await previewInvite(c.env, c.req.param("token"), user ?? null));
    })
    .post("/invites/:token/accept", authed, async (c) => {
      const req = await parseBody(inviteAcceptRequestSchema, c.req.json());
      const result = await acceptInvite(c.env, c.get("user"), c.req.param("token"), req.teamName);
      return c.json({ kind: result.kind, accountId: result.accountId });
    });
}

// /api/team/*（specs/008-team-operations contracts/api.md「パートナーのチーム」）。
// すべて access.ts の authorizeTeam を通す（チームのパートナー本人だけ。Constitution原則V）。
import { teamNameUpdateSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb, withTransaction } from "../db/client";
import { parseBody } from "../lib/validate";
import { authorizeTeam, isUuid, teamNotFound } from "../services/access";
import { getOrCreateTeamInvite } from "../services/invite-service";
import { getPartnerSummary } from "../services/partner-summary";
import { assignEditor, getTeam, removeEditor, renameTeam, unassignEditor } from "../services/team-service";

/**
 * パートナーのチームのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function teamRoutes(authed: MiddlewareHandler<AppEnv>) {
  /**
   * パスのIDがUUIDの形かを確かめる（違えば見つからない扱い）。
   * @param ids - 確かめるID
   */
  const assertIds = (...ids: string[]) => {
    if (!ids.every(isUuid)) throw teamNotFound();
  };
  return new Hono<AppEnv>()
    .get("/team", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const team = await authorizeTeam(db, c.get("user"));
      c.header("Cache-Control", "no-store");
      return c.json(await getTeam(db, team));
    })
    .get("/team/accounts", authed, async (c) => {
      // 手伝っているアカウントのまとめ（FR-061）
      const db = createDb(c.env.DATABASE_URL);
      const team = await authorizeTeam(db, c.get("user"));
      c.header("Cache-Control", "no-store");
      return c.json(await getPartnerSummary(db, team));
    })
    .patch("/team", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const team = await authorizeTeam(db, c.get("user"));
      const { name } = await parseBody(teamNameUpdateSchema, c.req.json());
      await renameTeam(db, team.team.id, name);
      return c.json(await getTeam(db, await authorizeTeam(db, c.get("user"))));
    })
    .get("/team/invite", authed, async (c) => {
      const team = await authorizeTeam(createDb(c.env.DATABASE_URL), c.get("user"));
      c.header("Cache-Control", "no-store");
      return c.json(await getOrCreateTeamInvite(c.env, team.team.id));
    })
    .post("/team/invite/rotate", authed, async (c) => {
      const team = await authorizeTeam(createDb(c.env.DATABASE_URL), c.get("user"));
      return c.json(await getOrCreateTeamInvite(c.env, team.team.id, { rotate: true }));
    })
    .put("/team/editors/:userId/accounts/:accountId", authed, async (c) => {
      const user = c.get("user");
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        // チームの行に鍵をかけて、担当の追加・外す・編集者を外す・パートナーを外すを直列にする（PR #9 のCodexレビュー）
        const team = await authorizeTeam(tx, user, { lock: true });
        assertIds(c.req.param("userId"), c.req.param("accountId"));
        await assignEditor(tx, team, c.req.param("userId"), c.req.param("accountId"));
      });
      return c.body(null, 204);
    })
    .delete("/team/editors/:userId/accounts/:accountId", authed, async (c) => {
      const user = c.get("user");
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        // チームの行に鍵をかけて、担当の追加・外す・編集者を外す・パートナーを外すを直列にする（PR #9 のCodexレビュー）
        const team = await authorizeTeam(tx, user, { lock: true });
        assertIds(c.req.param("userId"), c.req.param("accountId"));
        await unassignEditor(tx, team, c.req.param("userId"), c.req.param("accountId"));
      });
      return c.body(null, 204);
    })
    .delete("/team/editors/:userId", authed, async (c) => {
      const user = c.get("user");
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        // チームの行に鍵をかけて、担当の追加・外す・編集者を外す・パートナーを外すを直列にする（PR #9 のCodexレビュー）
        const team = await authorizeTeam(tx, user, { lock: true });
        assertIds(c.req.param("userId"));
        await removeEditor(tx, team, c.req.param("userId"));
      });
      return c.body(null, 204);
    });
}

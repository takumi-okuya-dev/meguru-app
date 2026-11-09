// /api/teams/*（specs/011-team-revision contracts/api.md「チーム」）。
// すべて access.ts の authorizeTeamMember／authorizeTeamAdmin を通す（Constitution原則V、research.md R4）。
// 書き込みはチームの行に鍵をかけてから行い、ロール・担当・抜ける・外す・引き継ぐを直列にする（research.md R7）。
// 001〜010と同じく「権限 → 入力の検証」の順で確かめる（鍵をかける前に、鍵なしで一度判定する）。
import {
  teamAccountAddSchema,
  teamAdminTransferSchema,
  teamCreateRequestSchema,
  teamLeaveRequestSchema,
  teamRenameRequestSchema,
  teamRoleUpdateSchema,
  teamShareUpdateSchema,
} from "@threads-grower/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { createDb, withTransaction } from "../../kernel/db/client";
import { parseBody } from "../../kernel/validate";
import { authorizeTeamAdmin, authorizeTeamMember, authorizeTeamStatus, isUuid, requireFeature, teamNotFound } from "../access/access";
import {
  addTeamAccount,
  changeRole,
  createTeam,
  deleteTeam,
  dismissJoinedNotice,
  getAssignments,
  getTeamDetail,
  getTeamInvite,
  leaveTeam,
  removeMember,
  removeTeamAccount,
  renameTeam,
  rotateTeamInvite,
  setAssignment,
  setShared,
  transferAdmin,
} from "./team-service";
import { getTeamStatus } from "./team-status";

/**
 * パスのIDがUUIDの形かを確かめる（違えば見つからない扱い）。
 * @param ids - 確かめるID
 */
const assertIds = (...ids: string[]) => {
  if (!ids.every(isUuid)) throw teamNotFound();
};

/**
 * 鍵をかける前に、鍵なしで判定する（入力の検証より先に権限を確かめるため）。
 * @param c - リクエスト
 * @param who - member：チームの人、admin：管理者
 */
async function precheck(c: Context<AppEnv>, who: "member" | "admin") {
  const db = createDb(c.env.DATABASE_URL);
  if (who === "admin") await authorizeTeamAdmin(db, c.get("user"), c.req.param("teamId")!);
  else await authorizeTeamMember(db, c.get("user"), c.req.param("teamId")!);
}

/**
 * チームのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function teamsRoutes(authed: MiddlewareHandler<AppEnv>) {
  // チームを使えない人は、チームを作ることも、チームの画面と操作も使えない（specs/019 FR-009、research.md R13）
  const teamOn: MiddlewareHandler<AppEnv> = async (c, next) => {
    requireFeature(c.get("user"), "team");
    await next();
  };
  return new Hono<AppEnv>()
    .post("/teams", authed, teamOn, async (c) => {
      const req = await parseBody(teamCreateRequestSchema, c.req.json());
      const teamId = await withTransaction(c.env.DATABASE_URL, (tx) => createTeam(c.env, tx, c.get("user"), req));
      return c.json({ teamId }, 201);
    })
    .get("/teams/:teamId", authed, teamOn, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeTeamMember(db, c.get("user"), c.req.param("teamId"));
      c.header("Cache-Control", "no-store");
      return c.json(await getTeamDetail(db, access));
    })
    // 運用状況（specs/020 contracts/api.md）。範囲は authorizeTeamStatus が決める。読むだけ
    .get("/teams/:teamId/status", authed, teamOn, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeTeamStatus(db, c.get("user"), c.req.param("teamId"));
      c.header("Cache-Control", "no-store");
      return c.json(await getTeamStatus(db, access, access.scope));
    })
    .patch("/teams/:teamId", authed, teamOn, async (c) => {
      await precheck(c, "admin");
      const { name } = await parseBody(teamRenameRequestSchema, c.req.json());
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await renameTeam(tx, access, name);
      });
      return c.body(null, 204);
    })
    .delete("/teams/:teamId", authed, teamOn, async (c) => {
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await deleteTeam(tx, access);
      });
      return c.body(null, 204);
    })
    .get("/teams/:teamId/invite", authed, teamOn, async (c) => {
      const access = await authorizeTeamAdmin(createDb(c.env.DATABASE_URL), c.get("user"), c.req.param("teamId"));
      c.header("Cache-Control", "no-store");
      return c.json(await getTeamInvite(c.env, access.team));
    })
    .post("/teams/:teamId/invite/rotate", authed, teamOn, async (c) => {
      const invite = await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        return rotateTeamInvite(c.env, tx, access);
      });
      return c.json(invite);
    })
    .patch("/teams/:teamId/members/:userId", authed, teamOn, async (c) => {
      await precheck(c, "admin");
      assertIds(c.req.param("userId"));
      const { role } = await parseBody(teamRoleUpdateSchema, c.req.json());
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await changeRole(tx, access, c.req.param("userId"), role);
      });
      return c.body(null, 204);
    })
    .delete("/teams/:teamId/members/:userId", authed, teamOn, async (c) => {
      await precheck(c, "admin");
      assertIds(c.req.param("userId"));
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await removeMember(tx, access, c.req.param("userId"));
      });
      return c.body(null, 204);
    })
    .post("/teams/:teamId/members/:userId/joined-notice/dismiss", authed, teamOn, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeTeamAdmin(db, c.get("user"), c.req.param("teamId"));
      assertIds(c.req.param("userId"));
      await dismissJoinedNotice(db, access.team.id, c.req.param("userId"));
      return c.body(null, 204);
    })
    .post("/teams/:teamId/leave", authed, teamOn, async (c) => {
      await precheck(c, "member");
      const { newAdminUserId } = await parseBody(teamLeaveRequestSchema, c.req.json().catch(() => ({})));
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamMember(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await leaveTeam(tx, access, newAdminUserId);
      });
      return c.body(null, 204);
    })
    .post("/teams/:teamId/admin", authed, teamOn, async (c) => {
      await precheck(c, "admin");
      const { userId } = await parseBody(teamAdminTransferSchema, c.req.json());
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await transferAdmin(tx, access, userId);
      });
      return c.body(null, 204);
    })
    .post("/teams/:teamId/accounts", authed, teamOn, async (c) => {
      await precheck(c, "member");
      const { accountId, shared } = await parseBody(teamAccountAddSchema, c.req.json());
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamMember(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await addTeamAccount(tx, access, accountId, shared ?? false, c.get("user").billing);
      });
      return c.body(null, 204);
    })
    .patch("/teams/:teamId/accounts/:accountId", authed, teamOn, async (c) => {
      await precheck(c, "member");
      assertIds(c.req.param("accountId"));
      const { shared } = await parseBody(teamShareUpdateSchema, c.req.json());
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamMember(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await setShared(tx, access, c.req.param("accountId"), shared);
      });
      return c.body(null, 204);
    })
    .delete("/teams/:teamId/accounts/:accountId", authed, teamOn, async (c) => {
      assertIds(c.req.param("accountId"));
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamMember(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await removeTeamAccount(tx, access, c.req.param("accountId"));
      });
      return c.body(null, 204);
    })
    .get("/teams/:teamId/assignments", authed, teamOn, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeTeamAdmin(db, c.get("user"), c.req.param("teamId"));
      c.header("Cache-Control", "no-store");
      return c.json(await getAssignments(db, access));
    })
    .put("/teams/:teamId/assignments/:userId/accounts/:accountId", authed, teamOn, async (c) => {
      assertIds(c.req.param("userId"), c.req.param("accountId"));
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await setAssignment(tx, access, c.req.param("userId"), c.req.param("accountId"), true);
      });
      return c.body(null, 204);
    })
    .delete("/teams/:teamId/assignments/:userId/accounts/:accountId", authed, teamOn, async (c) => {
      assertIds(c.req.param("userId"), c.req.param("accountId"));
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeTeamAdmin(tx, c.get("user"), c.req.param("teamId"), { lock: true });
        await setAssignment(tx, access, c.req.param("userId"), c.req.param("accountId"), false);
      });
      return c.body(null, 204);
    });
}

// /api/accounts/:accountId のチーム運用（specs/008-team-operations contracts/api.md「権限」「パートナーの招待」「チーム」）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb, withTransaction } from "../db/client";
import { authorizeAccount } from "../services/access";
import { recordActivity, updatedByOf } from "../services/activity-log";
import { cancelPartnerInvite, getPartnerInvite, upsertPartnerInvite } from "../services/invite-service";
import { delegationUpdateSchema } from "@threads-grower/shared";
import { AppError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { dismissJoinedNotice, getAccountTeam, removePartner, setDelegation } from "../services/team-service";

/**
 * Accountのチーム運用のルート。権限は contracts/permissions.md のとおり。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function accountTeamRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/access", authed, async (c) => {
      // 画面の出し分けに使う役割と権限（contracts/permissions.md「画面での出し分け」）
      const access = await authorizeAccount(createDb(c.env.DATABASE_URL), c.get("user"), c.req.param("accountId"), "view");
      c.header("Cache-Control", "no-store");
      return c.json({
        role: access.role,
        permissions: [...access.permissions],
        owner: { name: access.owner.name },
        hasTeam: access.hasTeam,
        team: access.team ? { name: access.team.name, partnerName: access.team.partnerName } : null,
        delegation: access.delegation,
      });
    })
    .get("/accounts/:accountId/partner-invite", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "owner");
      c.header("Cache-Control", "no-store");
      return c.json({ invite: await getPartnerInvite(c.env, db, access.account.id) });
    })
    .post("/accounts/:accountId/partner-invite", authed, async (c) => {
      const access = await authorizeAccount(createDb(c.env.DATABASE_URL), c.get("user"), c.req.param("accountId"), "owner");
      return c.json({ invite: await upsertPartnerInvite(c.env, access) });
    })
    .post("/accounts/:accountId/partner-invite/rotate", authed, async (c) => {
      const access = await authorizeAccount(createDb(c.env.DATABASE_URL), c.get("user"), c.req.param("accountId"), "owner");
      return c.json({ invite: await upsertPartnerInvite(c.env, access, { rotate: true }) });
    })
    .delete("/accounts/:accountId/partner-invite", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "owner");
      // 取り消しと操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        if (await cancelPartnerInvite(tx, access.account.id)) {
          await recordActivity(tx, access, { kind: "member", action: "partner_invite_canceled", force: true });
        }
      });
      return c.body(null, 204);
    })
    .get("/accounts/:accountId/team", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view");
      c.header("Cache-Control", "no-store");
      return c.json(await getAccountTeam(db, access));
    })
    .patch("/accounts/:accountId/partner", authed, async (c) => {
      // 任せる範囲（FR-030）。オーナーだけ
      const user = c.get("user");
      const accountId = c.req.param("accountId");
      await authorizeAccount(createDb(c.env.DATABASE_URL), user, accountId, "owner");
      const { delegation } = await parseBody(delegationUpdateSchema, c.req.json());
      const result = await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeAccount(tx, user, accountId, "owner");
        const changed = await setDelegation(tx, access.account.id, delegation);
        if (changed) {
          await recordActivity(tx, access, {
            kind: "member",
            action: "delegation_changed",
            details: { before: changed.before, after: changed.after },
          });
        }
        return changed;
      });
      if (!result) throw new AppError("ITEM_NOT_FOUND", 404, "no partner");
      return c.json({ delegation: result.after });
    })
    .delete("/accounts/:accountId/partner", authed, async (c) => {
      const user = c.get("user");
      const accountId = c.req.param("accountId");
      await withTransaction(c.env.DATABASE_URL, async (tx) => {
        const access = await authorizeAccount(tx, user, accountId, "owner");
        const removed = await removePartner(tx, access.account.id);
        if (removed) {
          // 外したことで hasTeam が false になっても書く（FR-054）
          const names = await Promise.all(removed.removed.map(async (r) => ({ role: r.role, name: (await updatedByOf(tx, r.userId))?.name ?? "" })));
          await recordActivity(tx, access, {
            kind: "member",
            action: "partner_removed",
            force: true,
            summary: access.team ? (access.team.name ?? access.team.partnerName) : null,
            details: {
              partner: names.find((n) => n.role === "partner")?.name ?? null,
              editors: names.filter((n) => n.role === "editor").map((n) => n.name),
            },
          });
        }
      });
      return c.body(null, 204);
    })
    .post("/accounts/:accountId/partner/joined-notice/dismiss", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "owner");
      await dismissJoinedNotice(db, access.account.id);
      return c.body(null, 204);
    });
}

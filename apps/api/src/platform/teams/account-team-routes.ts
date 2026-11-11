// /api/accounts/:accountId のチーム（specs/011-team-revision contracts/api.md「Account（変わる）」）。
import { FEATURES } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { createDb } from "../../kernel/db/client";
import { authorizeAccount } from "../access/access";
import { assignedNoticeVisible, dismissAssignedNotice, getAccountTeam } from "./team-service";

/**
 * Accountのチームのルート。権限は contracts/permissions.md のとおり。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function accountTeamRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/access", authed, async (c) => {
      // 画面の出し分けに使う関わりと権限（contracts/permissions.md「画面での出し分け」）
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "read");
      c.header("Cache-Control", "no-store");
      return c.json({
        relation: access.relation,
        permissions: [...access.permissions],
        owner: { name: access.owner.name },
        hasTeam: access.hasTeam,
        team: access.team,
        assignedNotice: await assignedNoticeVisible(db, access),
        // オーナーが読むだけなら、その理由（オーナー以外には owner_inactive。specs/013 FR-045）
        readOnly: access.readOnly,
        // オーナーの設定でONの機能のまとまり（specs/019 research.md R6）。並びは FEATURES の順
        features: FEATURES.filter((f) => access.features.has(f)),
      });
    })
    .get("/accounts/:accountId/team", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "read", { feature: "team" });
      c.header("Cache-Control", "no-store");
      return c.json(await getAccountTeam(db, access));
    })
    .post("/accounts/:accountId/assigned-notice/dismiss", authed, async (c) => {
      // 担当の知らせを閉じる（research.md R9）。担当の人が呼ぶ（オーナーが呼んでも何も変わらない）
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "content");
      await dismissAssignedNotice(db, access);
      return c.body(null, 204);
    });
}

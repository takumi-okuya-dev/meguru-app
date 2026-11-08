// /api/accounts/:accountId/tester-application（specs/024-tester-invite-connect contracts/api.md「利用者の申し込み」）。
// そのアカウントのオーナーだけ。招待の管理がOFFなら 404（research.md R4）。
import { testerApplyRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { parseBody } from "../lib/validate";
import { authorizeAccount } from "../services/access";
import { apply, assertTesterInvitesEnabled, cancel, getApplication } from "../services/tester-application-service";

/**
 * 利用者の申し込みのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function testerApplicationRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/tester-application", authed, async (c) => {
      assertTesterInvitesEnabled(c.env);
      const db = createDb(c.env.DATABASE_URL);
      const { account } = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "owner");
      return c.json({ enabled: true, application: await getApplication(db, account.id) });
    })
    .post("/accounts/:accountId/tester-application", authed, async (c) => {
      assertTesterInvitesEnabled(c.env);
      // 関わりの判定を、本文の検証より先にする（関係のない人には、存在の有無も分からない 404）
      await authorizeAccount(createDb(c.env.DATABASE_URL), c.get("user"), c.req.param("accountId"), "owner");
      const { threadsUsername } = await parseBody(testerApplyRequestSchema, c.req.json());
      return c.json(await apply(c.env, c.get("user"), c.req.param("accountId"), threadsUsername), 201);
    })
    .delete("/accounts/:accountId/tester-application", authed, async (c) => {
      await cancel(c.env, c.get("user"), c.req.param("accountId"));
      return c.body(null, 204);
    });
}

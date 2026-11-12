// /api/operator/app-access（specs/meguru/030-app-access plan.md「運営者のAPI」、FR-005）。運営者だけ。どの環境でも使える。
// 人ごと・テストのグループごとに、「運営者が開いた人だけ」のアプリを開く・閉じる。読むのは、人を探す・グループの詳しい内容の応答の appAccess。
import { appAccessRequestSchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { operatorOnly } from "../operator/operator-only";
import { parseBody } from "../../kernel/validate";
import { setGroupAppAccess, setUserAppAccess } from "./app-access-service";

/**
 * 運営者のアプリの利用の許可のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function operatorAppAccessRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .put("/operator/app-access/users/:userId", authed, operatorOnly, async (c) => {
      const { apps } = await parseBody(appAccessRequestSchema, c.req.json());
      return c.json(await setUserAppAccess(c.env, c.get("user"), c.req.param("userId"), apps));
    })
    .put("/operator/app-access/groups/:groupId", authed, operatorOnly, async (c) => {
      const { apps } = await parseBody(appAccessRequestSchema, c.req.json());
      return c.json(await setGroupAppAccess(c.env, c.get("user"), c.req.param("groupId"), apps));
    });
}

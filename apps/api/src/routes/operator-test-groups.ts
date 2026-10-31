// /api/operator/test-groups（specs/016-test-groups contracts/api.md「運営者のAPI」）。
// 運営者（OPERATOR_CLERK_USER_IDS）だけ。テスト用のグループがOFFの環境では、ルートがないのと同じ 404。
import { testGroupCreateRequestSchema, testGroupUpdateRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../app";
import { billingModeOf } from "../lib/config";
import { AppError } from "../lib/errors";
import {
  closeTestGroup,
  createTestGroup,
  listTestGroups,
  removeTestGroupMember,
  rotateTestGroupInvite,
  testGroupDetail,
  updateTestGroup,
} from "../services/test-group-service";

/**
 * 入力を確かめる。上限の範囲の誤りだけは TEST_GROUP_CAPACITY_INVALID にする（画面で上限の欄に出すため）。
 * @param schema - スキーマ
 * @param body - 本文
 * @returns 確かめた値
 * @throws AppError TEST_GROUP_CAPACITY_INVALID・VALIDATION_FAILED
 */
async function parseGroupInput<S extends z.ZodTypeAny>(schema: S, body: Promise<unknown>): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await body.catch(() => null));
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")))].filter(Boolean);
  if (fields.includes("capacity")) throw new AppError("TEST_GROUP_CAPACITY_INVALID", 400, "invalid capacity", undefined, ["capacity"]);
  throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, fields);
}

/**
 * 運営者のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function operatorTestGroupRoutes(authed: MiddlewareHandler<AppEnv>) {
  const enabledOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!billingModeOf(c.env).testGroups) return c.notFound();
    await next();
  };
  const operatorOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!c.get("user").testAccess.operator) throw new AppError("OPERATOR_ONLY", 403, "operator only");
    c.header("Cache-Control", "no-store");
    await next();
  };
  const guard = [enabledOnly, authed, operatorOnly] as const;
  return new Hono<AppEnv>()
    .get("/operator/test-groups", ...guard, async (c) => c.json({ groups: await listTestGroups(c.env) }))
    .post("/operator/test-groups", ...guard, async (c) => {
      const input = await parseGroupInput(testGroupCreateRequestSchema, c.req.json());
      return c.json(await createTestGroup(c.env, c.get("user"), input));
    })
    .get("/operator/test-groups/:groupId", ...guard, async (c) => c.json(await testGroupDetail(c.env, c.req.param("groupId"))))
    .patch("/operator/test-groups/:groupId", ...guard, async (c) => {
      const input = await parseGroupInput(testGroupUpdateRequestSchema, c.req.json());
      return c.json(await updateTestGroup(c.env, c.get("user"), c.req.param("groupId"), input));
    })
    .post("/operator/test-groups/:groupId/rotate-invite", ...guard, async (c) =>
      c.json(await rotateTestGroupInvite(c.env, c.get("user"), c.req.param("groupId"))),
    )
    .post("/operator/test-groups/:groupId/close", ...guard, async (c) =>
      c.json(await closeTestGroup(c.env, c.get("user"), c.req.param("groupId"))),
    )
    .delete("/operator/test-groups/:groupId/members/:userId", ...guard, async (c) =>
      c.json(await removeTestGroupMember(c.env, c.get("user"), c.req.param("groupId"), c.req.param("userId"))),
    );
}

// /api/operator/limits（specs/024-tester-invite-connect contracts/api.md「運営者の上限」）。運営者だけ。どの環境でも使える。
import { defaultLimitsRequestSchema, operatorUserQuerySchema, userLimitsRequestSchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { createDb } from "../../kernel/db/client";
import { AppError } from "../../kernel/errors";
import { parseBody } from "../../kernel/validate";
import { operatorOnly } from "./operator-only";
import { findLimitUser, listLimits, setDefaults, setUserLimits } from "./limit-service";

/**
 * 運営者の上限のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function operatorLimitRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/operator/limits", authed, operatorOnly, async (c) => c.json(await listLimits(createDb(c.env.DATABASE_URL))))
    .put("/operator/limits", authed, operatorOnly, async (c) => {
      const { limits } = await parseBody(defaultLimitsRequestSchema, c.req.json());
      return c.json(await setDefaults(c.env, c.get("user"), limits));
    })
    .get("/operator/limits/users", authed, operatorOnly, async (c) => {
      const parsed = operatorUserQuerySchema.safeParse({ email: c.req.query("email") });
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid email", undefined, ["email"]);
      return c.json(await findLimitUser(createDb(c.env.DATABASE_URL), c.env, parsed.data.email));
    })
    .put("/operator/limits/users/:userId", authed, operatorOnly, async (c) => {
      const { limits } = await parseBody(userLimitsRequestSchema, c.req.json());
      return c.json(await setUserLimits(c.env, c.get("user"), c.req.param("userId"), limits));
    });
}

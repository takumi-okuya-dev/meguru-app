// /api/operator/users・/api/operator/feature-settings（specs/019-feature-switches contracts/api.md「運営者のAPI」）。
// 運営者（OPERATOR_CLERK_USER_IDS）だけ。招待制（TEST_GROUPS_ENABLED）に関わらず、どの環境でも使える（research.md R5）。
import { featureSettingsRequestSchema, operatorUserQuerySchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { operatorOnly } from "../middleware/operator-only";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { findUserByEmail, listFeatureSettings, resetFeatureSettings, saveFeatureSettings } from "../services/feature-service";

/**
 * 運営者の機能の設定のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function operatorFeatureRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/operator/feature-settings", authed, operatorOnly, async (c) => c.json(await listFeatureSettings(createDb(c.env.DATABASE_URL))))
    .get("/operator/users", authed, operatorOnly, async (c) => {
      const parsed = operatorUserQuerySchema.safeParse({ email: c.req.query("email") });
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid email", undefined, ["email"]);
      return c.json(await findUserByEmail(createDb(c.env.DATABASE_URL), parsed.data.email));
    })
    .put("/operator/feature-settings/:userId", authed, operatorOnly, async (c) => {
      const { features } = await parseBody(featureSettingsRequestSchema, c.req.json());
      return c.json(await saveFeatureSettings(c.env, c.get("user"), c.req.param("userId"), features));
    })
    .delete("/operator/feature-settings/:userId", authed, operatorOnly, async (c) =>
      c.json(await resetFeatureSettings(c.env, c.get("user"), c.req.param("userId"))),
    );
}

// GET /api/accounts/:accountId/activity（specs/008-team-operations contracts/api.md「操作の記録」、FR-052）。
import { activityQuerySchema, invalidFields } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../../platform";
import { createDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { authorizeAccount } from "../access/access";
import { listActivity } from "./activity-log";

/**
 * 操作の記録のルート。オーナー・パートナーだけ（activity の権限）。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function activityRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/accounts/:accountId/activity", authed, async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "activity", { feature: "team" });
    const parsed = activityQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, invalidFields(parsed.error));
    c.header("Cache-Control", "no-store");
    return c.json(await listActivity(db, access.account.id, parsed.data));
  });
}

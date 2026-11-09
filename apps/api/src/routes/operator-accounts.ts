// /api/operator/accounts（specs/026-operator-accounts contracts/api.md）。運営者（OPERATOR_CLERK_USER_IDS）だけ。見るだけ。
import { operatorAccountsQuerySchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { operatorOnly } from "../middleware/operator-only";
import { listOperatorAccounts } from "../services/operator-account-service";

/**
 * 運営者のアカウント一覧のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function operatorAccountRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/operator/accounts", authed, operatorOnly, async (c) => {
    const parsed = operatorAccountsQuerySchema.safeParse({
      method: c.req.query("method"),
      q: c.req.query("q"),
      cursor: c.req.query("cursor"),
    });
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "query")))];
      throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, fields);
    }
    return c.json(await listOperatorAccounts(createDb(c.env.DATABASE_URL), parsed.data));
  });
}

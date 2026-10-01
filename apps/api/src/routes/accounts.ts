// /api/accounts/*（contracts/api.md）
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { findOwnedAccount, toAccountSummary } from "../services/access";

export function accountRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/accounts/:accountId", authed, async (c) => {
    // 副作用なし：DBに保存されている状態のまま返す
    const account = await findOwnedAccount(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("accountId"));
    return c.json(toAccountSummary(account));
  });
}

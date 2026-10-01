// /api/accounts/*（contracts/api.md）
import { openAccountRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { createThreadsClient } from "../lib/threads-client";
import { findOwnedAccount, toAccountSummary } from "../services/access";
import { openAccount, verifyConnection } from "../services/account-service";

export function accountRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId", authed, async (c) => {
      // 副作用なし：DBに保存されている状態のまま返す
      const account = await findOwnedAccount(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("accountId"));
      return c.json(toAccountSummary(account));
    })
    .post("/accounts/:accountId/open", authed, async (c) => {
      // ページをまたいで比べられる順序値として、受け取った時点のサーバー時刻を使う（research.md R10）
      const receivedAt = new Date();
      const parsed = openAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid open request");
      const db = createDb(c.env.DATABASE_URL);
      const userId = c.get("user").id;
      const account = await findOwnedAccount(db, userId, c.req.param("accountId"));
      await openAccount(c.env, userId, account.id, parsed.data, receivedAt);
      await verifyConnection(c.env, account.id, createThreadsClient(c.env));
      return c.json(toAccountSummary(await findOwnedAccount(db, userId, account.id)));
    });
}

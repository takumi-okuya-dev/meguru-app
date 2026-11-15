// 振込待ちの道筋（specs/collect/001-event-day-collection contracts/api.md 7。主催者だけ）。
import { confirmTransferRequestSchema, transferQuerySchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody, parseQuery } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { listTransfers, setTransferConfirmed } from "./transfer-service";

/**
 * 振込待ちの道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function transferRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/transfers", owner, async (c) => {
      const { q } = parseQuery(transferQuerySchema, c.req.query());
      return c.json(await listTransfers(createDb(c.env.DATABASE_URL), c.get("user").id, q));
    })
    .post("/transfers/:personId/confirm", owner, async (c) => {
      const { priceTierId } = await parseBody(confirmTransferRequestSchema, c.req.json().catch(() => ({})));
      return c.json(
        await setTransferConfirmed(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("personId"), true, { databaseUrl: c.env.DATABASE_URL, priceTierId }),
      );
    })
    .delete("/transfers/:personId/confirm", owner, async (c) => {
      return c.json(await setTransferConfirmed(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("personId"), false));
    });
}

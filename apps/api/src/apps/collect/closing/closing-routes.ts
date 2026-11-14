// 締めの道筋（specs/collect/001-event-day-collection contracts/api.md 6。主催者だけ）。
import { putSettlementRequestSchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { checkPaypay, closeEvent, closingSnapshot, putSettlement } from "./closing-service";
import { contentDisposition, exportCsv } from "./export-csv";

/**
 * 締めの道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function closingRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/events/:eventId/closing", owner, async (c) => {
      return c.json(await closingSnapshot(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")));
    })
    .put("/events/:eventId/settlements/:receiverKey", owner, async (c) => {
      const input = await parseBody(putSettlementRequestSchema, c.req.json());
      return c.json(await putSettlement(c.env.DATABASE_URL, c.get("user").id, c.req.param("eventId"), c.req.param("receiverKey"), input));
    })
    .post("/events/:eventId/paypay-check", owner, async (c) => {
      return c.json(await checkPaypay(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")));
    })
    .post("/events/:eventId/close", owner, async (c) => {
      return c.json(await closeEvent(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")));
    })
    .get("/events/:eventId/export.csv", owner, async (c) => {
      const { body, filename } = await exportCsv(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"));
      return c.body(body, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "private, no-store",
      });
    });
}

// /api/collect/events（specs/collect/001-event-day-collection contracts/api.md 2）。消す（まとめを残す）は PR3。
import { createCollectEventRequestSchema, updateCollectEventRequestSchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { notifyLive } from "../live/notify";
import { syncCollectUsage } from "../usage/usage";
import { createEvent, getEvent, listEvents, updateEvent } from "./event-service";

/**
 * イベントの道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function eventRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/events", owner, async (c) => {
      const events = await listEvents(createDb(c.env.DATABASE_URL), c.get("user").id, new Date());
      return c.json({ events });
    })
    .post("/events", owner, async (c) => {
      const input = await parseBody(createCollectEventRequestSchema, c.req.json());
      const userId = c.get("user").id;
      const event = await createEvent(c.env.DATABASE_URL, userId, input);
      // 「使っているアプリ」に出す（トランザクションのあと。失敗してもイベントは作れたまま）
      await syncCollectUsage(createDb(c.env.DATABASE_URL), userId);
      return c.json(event, 201);
    })
    .get("/events/:eventId", owner, async (c) => {
      return c.json(await getEvent(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")));
    })
    .patch("/events/:eventId", owner, async (c) => {
      const input = await parseBody(updateCollectEventRequestSchema, c.req.json());
      const event = await updateEvent(c.env.DATABASE_URL, c.get("user").id, c.req.param("eventId"), input);
      // 名前・払い方・区分が変わるので、受付の画面は全体を読み直す
      await notifyLive(c, event.id, { type: "resync", version: event.version });
      return c.json(event);
    });
}

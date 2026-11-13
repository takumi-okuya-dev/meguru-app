// /api/collect/events/:eventId/roster と /api/collect/past-attendees（specs/collect/001-event-day-collection contracts/api.md 3）。
import { addRosterPersonRequestSchema, bulkAddRosterRequestSchema, pastAttendeesQuerySchema, updateRosterPersonRequestSchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody, parseQuery } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { findPastAttendees } from "./past-attendees";
import { addPeopleBulk, addPerson, deletePerson, listRoster, updatePerson } from "./roster-service";

/**
 * 名簿の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function rosterRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/events/:eventId/roster", owner, async (c) => {
      return c.json(await listRoster(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")));
    })
    .post("/events/:eventId/roster", owner, async (c) => {
      const input = await parseBody(addRosterPersonRequestSchema, c.req.json());
      return c.json(await addPerson(c.env.DATABASE_URL, c.get("user").id, c.req.param("eventId"), input), 201);
    })
    .post("/events/:eventId/roster/bulk", owner, async (c) => {
      const input = await parseBody(bulkAddRosterRequestSchema, c.req.json());
      return c.json(await addPeopleBulk(c.env.DATABASE_URL, c.get("user").id, c.req.param("eventId"), input), 201);
    })
    .patch("/events/:eventId/roster/:personId", owner, async (c) => {
      const input = await parseBody(updateRosterPersonRequestSchema, c.req.json());
      return c.json(await updatePerson(c.env.DATABASE_URL, c.get("user").id, c.req.param("eventId"), c.req.param("personId"), input));
    })
    .delete("/events/:eventId/roster/:personId", owner, async (c) => {
      return c.json(await deletePerson(c.env.DATABASE_URL, c.get("user").id, c.req.param("eventId"), c.req.param("personId")));
    })
    .get("/past-attendees", owner, async (c) => {
      const { eventId, q } = parseQuery(pastAttendeesQuerySchema, c.req.query());
      return c.json({ candidates: await findPastAttendees(createDb(c.env.DATABASE_URL), c.get("user").id, eventId, q) });
    });
}

// /api/collect/events/:eventId/roster と /api/collect/past-attendees（specs/collect/001-event-day-collection contracts/api.md 3）。
import {
  addRosterPersonRequestSchema,
  bulkAddRosterRequestSchema,
  pastAttendeesQuerySchema,
  updateRosterPersonRequestSchema,
  type ReceptionPerson,
  type RosterPerson,
} from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody, parseQuery } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { notifyLive } from "../live/notify";
import { findPastAttendees } from "./past-attendees";
import { addPeopleBulk, addPerson, deletePerson, listRoster, updatePerson } from "./roster-service";

/**
 * 名簿の人を、会場の共有の知らせの形にする（メモは送らない。contracts/realtime.md 2）。
 * @param person - 名簿の人
 * @returns 受付の画面の名簿の人
 */
const receptionPersonOf = (person: RosterPerson): ReceptionPerson => ({
  id: person.id,
  number: person.number,
  name: person.name,
  kana: person.kana,
  media: person.media,
  priceTierId: person.priceTierId,
  tierUndecided: person.tierUndecided,
  sameName: false,
  selfEntered: person.selfEntered,
});

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
      const eventId = c.req.param("eventId");
      const result = await addPerson(c.env.DATABASE_URL, c.get("user").id, eventId, input);
      await notifyLive(c, eventId, { type: "roster.changed", version: result.version, personId: result.person.id, person: receptionPersonOf(result.person) });
      return c.json(result, 201);
    })
    .post("/events/:eventId/roster/bulk", owner, async (c) => {
      const input = await parseBody(bulkAddRosterRequestSchema, c.req.json());
      const eventId = c.req.param("eventId");
      const result = await addPeopleBulk(c.env.DATABASE_URL, c.get("user").id, eventId, input);
      // 何人も増えるので、受付の画面は全体を読み直す
      await notifyLive(c, eventId, { type: "roster.changed", version: result.version });
      return c.json(result, 201);
    })
    .patch("/events/:eventId/roster/:personId", owner, async (c) => {
      const input = await parseBody(updateRosterPersonRequestSchema, c.req.json());
      const eventId = c.req.param("eventId");
      const result = await updatePerson(c.env.DATABASE_URL, c.get("user").id, eventId, c.req.param("personId"), input);
      await notifyLive(c, eventId, { type: "roster.changed", version: result.version, personId: result.person.id, person: receptionPersonOf(result.person) });
      return c.json(result);
    })
    .delete("/events/:eventId/roster/:personId", owner, async (c) => {
      const eventId = c.req.param("eventId");
      const result = await deletePerson(c.env.DATABASE_URL, c.get("user").id, eventId, c.req.param("personId"));
      // 消した人の行（と受付の記録）は、全体を読み直して消す
      await notifyLive(c, eventId, { type: "roster.changed", version: result.version });
      return c.json(result);
    })
    .get("/past-attendees", owner, async (c) => {
      const { eventId, q } = parseQuery(pastAttendeesQuerySchema, c.req.query());
      return c.json({ candidates: await findPastAttendees(createDb(c.env.DATABASE_URL), c.get("user").id, eventId, q) });
    });
}

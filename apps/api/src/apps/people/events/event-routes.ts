// /api/people/events の道筋（specs/people/001-people-memo contracts/api.md 2）。
import { eventCreateSchema, eventUpdateSchema, keepPeopleSchema } from "@meguru/shared/people";
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { createEvent, deleteEvent, eventAttendees, eventDeletePreview, eventDetail, listEvents, updateEvent } from "./event-service";

/**
 * イベントの道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function eventRoutes() {
  return new Hono<AppEnv>()
    .get("/events", async (c) => c.json({ events: await listEvents(createDb(c.env.DATABASE_URL), c.get("user").id) }))
    .post("/events", async (c) => {
      const input = await parseBody(eventCreateSchema, c.req.json());
      return c.json({ event: await createEvent(createDb(c.env.DATABASE_URL), c.get("user").id, input) }, 201);
    })
    .get("/events/:eventId", async (c) => c.json(await eventDetail(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"))))
    .get("/events/:eventId/attendees", async (c) =>
      c.json({ attendees: await eventAttendees(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")) }),
    )
    .patch("/events/:eventId", async (c) => {
      const input = await parseBody(eventUpdateSchema, c.req.json());
      return c.json({ event: await updateEvent(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), input) });
    })
    .get("/events/:eventId/delete-preview", async (c) =>
      c.json(await eventDeletePreview(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"))),
    )
    .delete("/events/:eventId", async (c) => {
      const { keepPeopleWithNotes } = await parseBody(keepPeopleSchema, c.req.json().catch(() => ({})));
      return c.json(await deleteEvent(c.env, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), keepPeopleWithNotes));
    });
}

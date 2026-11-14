// GET /api/people/me（specs/people/001-people-memo contracts/api.md 1）。退会の確かめ・初めての案内に使う数。
import type { PeopleMe } from "@meguru/shared/people";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import type { AppEnv } from "../../../platform";
import { peopleEvents, peoplePersons } from "../schema";

/**
 * 人物メモの「自分」の道筋。
 * @returns Hono のルート
 */
export function peopleMeRoutes() {
  return new Hono<AppEnv>().get("/me", async (c) => {
    c.header("Cache-Control", "no-store");
    const db = createDb(c.env.DATABASE_URL);
    const userId = c.get("user").id;
    const [[persons], [events]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(peoplePersons).where(eq(peoplePersons.userId, userId)),
      db.select({ n: sql<number>`count(*)::int` }).from(peopleEvents).where(eq(peopleEvents.userId, userId)),
    ]);
    const body: PeopleMe = { personCount: Number(persons?.n ?? 0), eventCount: Number(events?.n ?? 0) };
    return c.json(body);
  });
}

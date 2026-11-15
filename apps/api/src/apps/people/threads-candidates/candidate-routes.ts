// /api/people/threads-candidates（specs/people/003-threads-event-candidates plan.md API）。
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import type { AppEnv } from "../../../platform";
import { listCandidates } from "./candidate-service";

/**
 * Threads のイベントの候補の道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function candidateRoutes() {
  return new Hono<AppEnv>().get("/threads-candidates", async (c) =>
    c.json({ candidates: await listCandidates(createDb(c.env.DATABASE_URL), c.get("user").id, new Date()) }),
  );
}

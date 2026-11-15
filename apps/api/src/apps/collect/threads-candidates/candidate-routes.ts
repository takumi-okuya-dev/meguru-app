// /api/collect/threads-candidates（specs/collect/001-event-day-collection contracts/api.md 7。User Story 6）。
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import type { AppEnv } from "../../../platform";
import { listCandidates } from "./candidate-service";

/**
 * Threads のイベントの候補の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function candidateRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/threads-candidates", owner, async (c) => {
    return c.json({ candidates: await listCandidates(createDb(c.env.DATABASE_URL), c.get("user").id, new Date()) });
  });
}

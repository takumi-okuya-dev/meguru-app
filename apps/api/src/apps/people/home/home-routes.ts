// /api/people/home の道筋（specs/people/002-sales-list plan.md 3）。
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import type { AppEnv } from "../../../platform";
import { getHome } from "./home-service";

/**
 * ホームの道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function homeRoutes() {
  return new Hono<AppEnv>().get("/home", async (c) => c.json(await getHome(createDb(c.env.DATABASE_URL), c.get("user").id)));
}

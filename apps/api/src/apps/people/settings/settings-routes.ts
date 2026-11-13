// /api/people/settings・/api/people/stats の道筋（specs/people/001-people-memo contracts/api.md 6）。
import { settingsUpdateSchema } from "@meguru/shared/people";
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { getSettings, getStats, updateSettings } from "./settings-service";

/**
 * 設定と数字の道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function settingsRoutes() {
  return new Hono<AppEnv>()
    .get("/settings", async (c) => c.json(await getSettings(createDb(c.env.DATABASE_URL), c.get("user").id)))
    .put("/settings", async (c) => {
      const input = await parseBody(settingsUpdateSchema, c.req.json());
      return c.json(await updateSettings(c.env, c.get("user").id, input));
    })
    .get("/stats", async (c) => c.json(await getStats(createDb(c.env.DATABASE_URL), c.get("user").id)));
}

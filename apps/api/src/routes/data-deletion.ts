// GET /api/data-deletion/:confirmationCode（認証不要。確認コードは推測できない乱数）
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { deletionStatus } from "../services/data-deletion";

export function dataDeletionRoutes() {
  return new Hono<AppEnv>().get("/data-deletion/:confirmationCode", async (c) => {
    const status = await deletionStatus(c.env, c.req.param("confirmationCode"));
    if (!status) return c.json({ error: { code: "ACCOUNT_NOT_FOUND" as const, message: "not found" } }, 404);
    return c.json(status);
  });
}

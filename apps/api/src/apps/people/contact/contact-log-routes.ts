// 連絡の記録・次にやることを終える の道筋（specs/people/002-sales-list plan.md 3）。
import { contactLogCreateSchema, contactLogUpdateSchema, nextActionDoneSchema } from "@meguru/shared/people";
import { Hono } from "hono";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { addContactLog, deleteContactLog, finishNextAction, updateContactLog } from "./contact-log-service";

/**
 * 連絡の記録の道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function contactLogRoutes() {
  return new Hono<AppEnv>()
    .post("/persons/:personId/contact-logs", async (c) => {
      const input = await parseBody(contactLogCreateSchema, c.req.json());
      return c.json({ log: await addContactLog(c.env, c.get("user").id, c.req.param("personId"), input) }, 201);
    })
    .patch("/contact-logs/:logId", async (c) => {
      const input = await parseBody(contactLogUpdateSchema, c.req.json());
      return c.json({ log: await updateContactLog(c.env, c.get("user").id, c.req.param("logId"), input) });
    })
    .delete("/contact-logs/:logId", async (c) => {
      await deleteContactLog(c.env, c.get("user").id, c.req.param("logId"));
      return c.body(null, 204);
    })
    .post("/persons/:personId/next-action/done", async (c) => {
      const { log } = await parseBody(nextActionDoneSchema, c.req.json());
      await finishNextAction(c.env, c.get("user").id, c.req.param("personId"), log);
      return c.json({ ok: true });
    });
}

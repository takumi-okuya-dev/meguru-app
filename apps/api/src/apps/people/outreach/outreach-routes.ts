// /api/people/candidates・/api/people/outreaches の道筋（specs/people/001-people-memo contracts/api.md 5）。
import { candidateQuerySchema, outreachCreateSchema, outreachUpdateSchema } from "@meguru/shared/people";
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody, parseQuery } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { listCandidates } from "./candidate-service";
import { createInviteOutreach, deleteOutreach, updateOutreachStage } from "./outreach-service";

/**
 * 誘う候補と声かけの道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function outreachRoutes() {
  return new Hono<AppEnv>()
    .get("/candidates", async (c) => {
      // くり返せるクエリ（next・wanted・career）は queries で読む
      const raw = { ...c.req.query(), next: c.req.queries("next"), wanted: c.req.queries("wanted"), career: c.req.queries("career") };
      return c.json(await listCandidates(createDb(c.env.DATABASE_URL), c.get("user").id, parseQuery(candidateQuerySchema, raw)));
    })
    .post("/outreaches", async (c) => {
      const input = await parseBody(outreachCreateSchema, c.req.json());
      const { outreach, created } = await createInviteOutreach(c.env, c.get("user").id, input);
      return c.json({ outreach }, created ? 201 : 200);
    })
    .patch("/outreaches/:outreachId", async (c) => {
      const { stage } = await parseBody(outreachUpdateSchema, c.req.json());
      return c.json({ outreach: await updateOutreachStage(c.env, c.get("user").id, c.req.param("outreachId"), stage) });
    })
    .delete("/outreaches/:outreachId", async (c) => {
      await deleteOutreach(c.env, c.get("user").id, c.req.param("outreachId"));
      return c.body(null, 204);
    });
}

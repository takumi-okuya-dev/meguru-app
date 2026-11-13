// /api/people/persons・/api/people/facets・/api/people/responses の道筋（specs/people/001-people-memo contracts/api.md 4）。
import {
  attendanceCreateSchema,
  consentUpdateSchema,
  personCreateSchema,
  personDeleteSchema,
  personListQuerySchema,
  personExportSchema,
  personMergeSchema,
  personUpdateSchema,
} from "@meguru/shared/people";
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody, parseQuery } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { addAttendance, createPerson, removeAttendance } from "./person-create";
import { deletePerson } from "./person-delete";
import { listFacets, listPersons } from "./person-list";
import { mergePersons, splitResponse } from "./person-merge";
import { exportPersons } from "./person-export";
import { personDetail, updateConsent, updatePerson } from "./person-service";

/**
 * 人の道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function personRoutes() {
  return new Hono<AppEnv>()
    .get("/persons", async (c) => {
      // くり返せるクエリ（next・wanted・career・tag・likelihood）は queries で読む
      const raw = {
        ...c.req.query(),
        next: c.req.queries("next"),
        wanted: c.req.queries("wanted"),
        career: c.req.queries("career"),
        tag: c.req.queries("tag"),
        likelihood: c.req.queries("likelihood"),
      };
      return c.json(await listPersons(createDb(c.env.DATABASE_URL), c.get("user").id, parseQuery(personListQuerySchema, raw)));
    })
    .get("/facets", async (c) => c.json(await listFacets(createDb(c.env.DATABASE_URL), c.get("user").id)))
    // 書き出し（絞り込みは本文で受ける。名前を URL に載せない。/persons/:personId より先に置く）
    .post("/persons/export", async (c) => {
      const input = await parseBody(personExportSchema, c.req.json().catch(() => ({})));
      const { filename, body, truncated } = await exportPersons(createDb(c.env.DATABASE_URL), c.get("user").id, { ...input, offset: 0 });
      return c.body(body, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Export-Truncated": truncated ? "true" : "false",
      });
    })
    .post("/persons", async (c) => {
      const input = await parseBody(personCreateSchema, c.req.json());
      return c.json({ person: await createPerson(c.env, c.get("user").id, input) }, 201);
    })
    .get("/persons/:personId", async (c) => c.json(await personDetail(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("personId"))))
    .patch("/persons/:personId", async (c) => {
      const input = await parseBody(personUpdateSchema, c.req.json());
      return c.json({ person: await updatePerson(c.env, c.get("user").id, c.req.param("personId"), input) });
    })
    .put("/persons/:personId/consent", async (c) => {
      const input = await parseBody(consentUpdateSchema, c.req.json());
      return c.json({ consent: await updateConsent(c.env, c.get("user").id, c.req.param("personId"), input) });
    })
    .post("/persons/:personId/attendances", async (c) => {
      const { eventId } = await parseBody(attendanceCreateSchema, c.req.json());
      return c.json({ person: await addAttendance(c.env, c.get("user").id, c.req.param("personId"), eventId) });
    })
    .delete("/persons/:personId/attendances/:eventId", async (c) => {
      await removeAttendance(c.env, c.get("user").id, c.req.param("personId"), c.req.param("eventId"));
      return c.body(null, 204);
    })
    .post("/persons/:personId/merge", async (c) => {
      const { otherPersonId } = await parseBody(personMergeSchema, c.req.json());
      return c.json({ person: await mergePersons(c.env, c.get("user").id, c.req.param("personId"), otherPersonId) });
    })
    .delete("/persons/:personId", async (c) => {
      const { confirmName } = await parseBody(personDeleteSchema, c.req.json());
      await deletePerson(c.env, c.get("user").id, c.req.param("personId"), confirmName);
      return c.body(null, 204);
    })
    .post("/responses/:responseId/split", async (c) => c.json({ person: await splitResponse(c.env, c.get("user").id, c.req.param("responseId")) }, 201));
}

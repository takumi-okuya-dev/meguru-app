// /api/people/fields・/api/people/persons/:personId/fields・links の道筋（specs/people/002-sales-list plan.md 3）。
import { fieldOrderSchema, fieldSaveSchema, personFieldsSchema, personLinksSchema } from "@meguru/shared/people";
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { createField, deleteField, listFields, renameField, reorderFields, setPersonFields, setPersonLinks } from "./field-service";

/**
 * 自由な項目と SNS のリンクの道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function fieldRoutes() {
  return new Hono<AppEnv>()
    .get("/fields", async (c) => c.json({ fields: await listFields(createDb(c.env.DATABASE_URL), c.get("user").id) }))
    .post("/fields", async (c) => {
      const { label } = await parseBody(fieldSaveSchema, c.req.json());
      return c.json({ field: await createField(c.env, c.get("user").id, label) }, 201);
    })
    // 並べ替えは /fields/:fieldId より先に置く（order を番号と読まないように）
    .put("/fields/order", async (c) => {
      const { fieldIds } = await parseBody(fieldOrderSchema, c.req.json());
      return c.json({ fields: await reorderFields(c.env, c.get("user").id, fieldIds) });
    })
    .patch("/fields/:fieldId", async (c) => {
      const { label } = await parseBody(fieldSaveSchema, c.req.json());
      return c.json({ field: await renameField(c.env, c.get("user").id, c.req.param("fieldId"), label) });
    })
    .delete("/fields/:fieldId", async (c) => {
      await deleteField(c.env, c.get("user").id, c.req.param("fieldId"));
      return c.body(null, 204);
    })
    .put("/persons/:personId/fields", async (c) => {
      const { values } = await parseBody(personFieldsSchema, c.req.json());
      return c.json({ fields: await setPersonFields(c.env, c.get("user").id, c.req.param("personId"), values) });
    })
    .put("/persons/:personId/links", async (c) => {
      const input = await parseBody(personLinksSchema, c.req.json());
      return c.json({ links: await setPersonLinks(c.env, c.get("user").id, c.req.param("personId"), input) });
    });
}

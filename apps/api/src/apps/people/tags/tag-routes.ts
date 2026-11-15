// /api/people/tags・/api/people/persons/:personId/tags の道筋（specs/people/002-sales-list plan.md 3）。
import { personTagsSchema, tagSaveSchema } from "@meguru/shared/people";
import { Hono } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { createTag, deleteTag, listTags, renameTag, setPersonTags } from "./tag-service";

/**
 * タグの道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function tagRoutes() {
  return new Hono<AppEnv>()
    .get("/tags", async (c) => c.json({ tags: await listTags(createDb(c.env.DATABASE_URL), c.get("user").id) }))
    .post("/tags", async (c) => {
      const { name } = await parseBody(tagSaveSchema, c.req.json());
      return c.json({ tag: await createTag(c.env, c.get("user").id, name) }, 201);
    })
    .patch("/tags/:tagId", async (c) => {
      const { name } = await parseBody(tagSaveSchema, c.req.json());
      return c.json({ tag: await renameTag(c.env, c.get("user").id, c.req.param("tagId"), name) });
    })
    .delete("/tags/:tagId", async (c) => {
      await deleteTag(c.env, c.get("user").id, c.req.param("tagId"));
      return c.body(null, 204);
    })
    .put("/persons/:personId/tags", async (c) => {
      const input = await parseBody(personTagsSchema, c.req.json());
      return c.json({ tags: await setPersonTags(c.env, c.get("user").id, c.req.param("personId"), input) });
    });
}

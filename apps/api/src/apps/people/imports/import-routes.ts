// /api/people/imports の道筋（specs/people/001-people-memo contracts/api.md 3）。
import { importCommitSchema, importPreviewSchema, keepPeopleSchema } from "@meguru/shared/people";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createDb, withTransaction } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { logger } from "../../../kernel/logger";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { loadOwnedImport, lockOwner } from "../access";
import { reportPeopleUsage } from "../usage";
import { commitImport, previewImport } from "./import-service";
import { executeUndo, planUndo } from "./undo";

/** 取り込みの本文の上限（data-model.md 5）。 */
const IMPORT_BODY_MAX_BYTES = 1_500_000;

/** 本文の上限を超えたら 400 IMPORT_TOO_LARGE。 */
const importBodyLimit = bodyLimit({
  maxSize: IMPORT_BODY_MAX_BYTES,
  onError: () => {
    throw new AppError("IMPORT_TOO_LARGE", 400, "import too large", undefined, ["body"]);
  },
});

/**
 * 取り込みの道筋（ログインと利用の許可の関所は、上の peopleRoutes が付ける）。
 * @returns Hono のルート
 */
export function importRoutes() {
  return new Hono<AppEnv>()
    .post("/imports/preview", importBodyLimit, async (c) => {
      const input = await parseBody(importPreviewSchema, c.req.json());
      return c.json(await previewImport(createDb(c.env.DATABASE_URL), c.get("user").id, input));
    })
    .post("/imports", importBodyLimit, async (c) => {
      const input = await parseBody(importCommitSchema, c.req.json());
      return c.json(await commitImport(c.env, createDb(c.env.DATABASE_URL), c.get("user").id, input), 201);
    })
    .get("/imports/:importId/undo-preview", async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const userId = c.get("user").id;
      const imp = await loadOwnedImport(db, userId, c.req.param("importId"));
      const plan = await planUndo(db, userId, [imp.id]);
      return c.json({ responseCount: plan.responseCount, removedPeopleCount: plan.removable.length, peopleWithNotes: plan.peopleWithNotes });
    })
    .delete("/imports/:importId", async (c) => {
      const { keepPeopleWithNotes } = await parseBody(keepPeopleSchema, c.req.json().catch(() => ({})));
      const userId = c.get("user").id;
      const importId = c.req.param("importId");
      const result = await withTransaction(c.env.DATABASE_URL, async (tx) => {
        await lockOwner(tx, userId);
        await loadOwnedImport(tx, userId, importId);
        return executeUndo(tx, userId, [importId], keepPeopleWithNotes);
      });
      logger.info("people import undone", { importId, removedPeople: result.removedPeopleCount });
      await reportPeopleUsage(createDb(c.env.DATABASE_URL), userId);
      return c.json(result);
    });
}

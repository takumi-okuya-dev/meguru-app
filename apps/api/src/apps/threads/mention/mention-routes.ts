// /api/accounts/:accountId/mention-*・…/post-drafts/:draftId/mention（specs/023-delayed-mention contracts/api.md）。
// 設定を読むのは view、変えるのは settings、付ける・外す・やめる・返信するのは review。どれも機能のまとまり「自動投稿」（019）。
import {
  mentionAttachRequestSchema,
  mentionBulkRequestSchema,
  mentionDetachRequestSchema,
  mentionPersonPatchSchema,
  mentionPersonRequestSchema,
  mentionSettingsRequestSchema,
} from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../../platform";
import { createDb, withTransaction } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import { authorizeAccount } from "../../../platform";
import { assertItemId } from "../strategy/item-service";
import {
  addMentionPerson,
  attachMention,
  attachMentionsBulk,
  detachMention,
  getMentionSettings,
  removeMentionPerson,
  saveMentionSettings,
  updateMentionPerson,
} from "./mention-service";

/**
 * 時間差のメンションのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function mentionRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/mention-settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view", { feature: "autopost" });
      c.header("Cache-Control", "no-store");
      return c.json(await getMentionSettings(db, access));
    })
    .put("/accounts/:accountId/mention-settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings", { feature: "autopost" });
      const req = await parseBody(mentionSettingsRequestSchema, c.req.json());
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => saveMentionSettings(tx, access, req)));
    })
    .post("/accounts/:accountId/mention-people", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings", { feature: "autopost" });
      const req = await parseBody(mentionPersonRequestSchema, c.req.json());
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => addMentionPerson(tx, access, req)), 201);
    })
    .patch("/accounts/:accountId/mention-people/:personId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings", { feature: "autopost" });
      const personId = assertItemId(c.req.param("personId"));
      const req = await parseBody(mentionPersonPatchSchema, c.req.json());
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => updateMentionPerson(tx, access, personId, req)));
    })
    .delete("/accounts/:accountId/mention-people/:personId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings", { feature: "autopost" });
      const personId = assertItemId(c.req.param("personId"));
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => removeMentionPerson(tx, access, personId)));
    })
    .post("/accounts/:accountId/post-drafts/mentions", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "review", { feature: "autopost" });
      const req = await parseBody(mentionBulkRequestSchema, c.req.json());
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => attachMentionsBulk(c.env, tx, access, req.items, new Date())));
    })
    .put("/accounts/:accountId/post-drafts/:draftId/mention", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "review", { feature: "autopost" });
      const draftId = assertItemId(c.req.param("draftId"));
      const req = await parseBody(mentionAttachRequestSchema, c.req.json());
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => attachMention(c.env, tx, access, draftId, req, new Date())));
    })
    .delete("/accounts/:accountId/post-drafts/:draftId/mention", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "review", { feature: "autopost" });
      const draftId = assertItemId(c.req.param("draftId"));
      const req = await parseBody(mentionDetachRequestSchema, c.req.json().catch(() => ({})));
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => detachMention(tx, access, draftId, req.expectedVersion)));
    });
}

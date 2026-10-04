// /api/accounts/:accountId/posting-rules・/ng-words（specs/004-review-approval contracts/api.md）。
// NGワードは全プランで使える（FR-017）ので、grower機能は判定しない。
import { addNgWordsRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { parseBody } from "../lib/validate";
import { findOwnedAccount } from "../services/access";
import { assertItemId } from "../services/item-service";
import { addNgWords, deleteNgWord, getPostingRules } from "../services/posting-rules-service";

/**
 * 投稿のルールのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function postingRulesRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/posting-rules", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      return c.json(await getPostingRules(db, account, user));
    })
    .post("/accounts/:accountId/ng-words", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      const { words } = await parseBody(addNgWordsRequestSchema, c.req.json());
      return c.json(await addNgWords(c.env, account.id, words));
    })
    .delete("/accounts/:accountId/ng-words/:ngWordId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      await deleteNgWord(c.env, account.id, assertItemId(c.req.param("ngWordId")));
      return c.body(null, 204);
    });
}

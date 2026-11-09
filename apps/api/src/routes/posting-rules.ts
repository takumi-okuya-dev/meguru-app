// /api/accounts/:accountId/posting-rules・/ng-words（specs/004-review-approval contracts/api.md）。
// NGワードは全プランで使える（FR-017）ので、grower機能は判定しない。投稿ルールの保存だけを判定する（FR-020）。
import { addNgWordsRequestSchema, coreRulesRequestSchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../kernel/db/client";
import { withActivityTx } from "../platform";
import { parseBody } from "../kernel/validate";
import { authorizeAccount } from "../platform";
import { assertItemId } from "../services/item-service";
import { addNgWords, deleteNgWord, getPostingRules, saveCoreRules } from "../services/posting-rules-service";

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
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view", { feature: "autopost" });
      const account = access.account;
      return c.json(await getPostingRules(db, account, access.permissions.has("settings")));
    })
    .post("/accounts/:accountId/ng-words", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings", { feature: "autopost" });
      const account = access.account;
      const { words } = await parseBody(addNgWordsRequestSchema, c.req.json());
      return c.json(await addNgWords(c.env, account.id, words, access));
    })
    .delete("/accounts/:accountId/ng-words/:ngWordId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings", { feature: "autopost" });
      const account = access.account;
      await deleteNgWord(c.env, account.id, assertItemId(c.req.param("ngWordId")), access);
      return c.body(null, 204);
    })
    .put("/accounts/:accountId/core-rules", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "settings", { feature: "autopost" });
      const account = access.account;
      const req = await parseBody(coreRulesRequestSchema, c.req.json());
      // 保存と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
      return c.json(await withActivityTx(c.env.DATABASE_URL, db, access, (q) => saveCoreRules(q, account.id, req, access)));
    });
}

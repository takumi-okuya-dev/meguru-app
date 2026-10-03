// /api/accounts/:accountId/post-drafts と /draft-batches（specs/003-prompt-bulk-register contracts/api.md）。
// 下書きの操作は全プランで使えるので、grower機能は判定しない（research.md R10）。
import { NEEDS_REVIEW_LIMIT } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { findOwnedAccount } from "../services/access";
import { listDraftRows, toPostDraft } from "../services/draft-service";
import { canEditProfile } from "../services/grower-access";

/**
 * 投稿ストックの下書きのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function postDraftRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/accounts/:accountId/post-drafts", authed, async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const user = c.get("user");
    const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
    const rows = await listDraftRows(db, account.id);
    return c.json({
      items: rows.map(toPostDraft),
      limit: NEEDS_REVIEW_LIMIT,
      canGeneratePrompt: canEditProfile(account, user),
      promptPostCount: account.promptPostCount,
    });
  });
}

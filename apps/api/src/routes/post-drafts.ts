// /api/accounts/:accountId/post-drafts と /draft-batches（specs/003-prompt-bulk-register contracts/api.md）。
// 下書きの操作は全プランで使えるので、grower機能は判定しない（research.md R10）。
import {
  APPROVED_LIMIT,
  NEEDS_REVIEW_LIMIT,
  createDraftBatchRequestSchema,
  deletePostDraftsRequestSchema,
  publishedQuerySchema,
  reviewRequestSchema,
  prioritizeRequestSchema,
  updatePostDraftRequestSchema,
} from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { findOwnedAccount } from "../services/access";
import {
  prioritizeDraft,
  countDrafts,
  createDraftBatch,
  deleteBatch,
  deleteDrafts,
  listAllDrafts,
  listPublishedPage,
  updateDraft,
} from "../services/draft-service";
import { canEditProfile } from "../services/grower-access";
import { assertItemId } from "../services/item-service";
import { listNgWords, toNgWord } from "../services/posting-rules-service";
import { reviewDrafts } from "../services/review-service";

/**
 * 投稿ストックの下書きのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function postDraftRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/post-drafts", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      const [drafts, ngWordRows] = await Promise.all([
        listAllDrafts(db, account),
        listNgWords(db, account.id),
      ]);
      return c.json({
        ...drafts,
        limits: { needsReview: NEEDS_REVIEW_LIMIT, approved: APPROVED_LIMIT },
        ngWords: ngWordRows.map(toNgWord),
        canGeneratePrompt: canEditProfile(account, user),
        promptPostCount: account.promptPostCount,
      });
    })
    .get("/accounts/:accountId/post-drafts/published", authed, async (c) => {
      // 投稿済みのタブ（005 FR-020）。タブを開いたときだけ50件ずつ読む（research.md R14）
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      const parsed = publishedQuerySchema.safeParse(c.req.query());
      if (!parsed.success)
        throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, ["limit"]);
      return c.json(await listPublishedPage(db, account.id, parsed.data));
    })
    .get("/accounts/:accountId/post-drafts/counts", authed, async (c) => {
      // サイドバーの件数（FR-013）。本文を含まない軽いAPI
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      return c.json(await countDrafts(db, account.id));
    })
    .post("/accounts/:accountId/draft-batches", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      const req = await parseBody(createDraftBatchRequestSchema, c.req.json());
      const { created, result } = await createDraftBatch(c.env, account.id, req);
      return c.json(result, created ? 201 : 200);
    })
    .delete("/accounts/:accountId/draft-batches/:batchId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      const batchId = assertItemId(c.req.param("batchId"));
      return c.json({ deletedCount: await deleteBatch(db, account.id, batchId) });
    })
    .put("/accounts/:accountId/post-drafts/:draftId", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      const id = assertItemId(c.req.param("draftId"));
      const req = await parseBody(updatePostDraftRequestSchema, c.req.json());
      return c.json(await updateDraft(c.env, account.id, id, req));
    })
    .post("/accounts/:accountId/post-drafts/delete", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      const { ids } = await parseBody(deletePostDraftsRequestSchema, c.req.json());
      return c.json({ deletedCount: await deleteDrafts(db, account.id, ids) });
    })
    .post("/accounts/:accountId/post-drafts/:draftId/prioritize", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      const id = assertItemId(c.req.param("draftId"));
      const req = await parseBody(prioritizeRequestSchema, c.req.json());
      return c.json(await prioritizeDraft(c.env, account.id, id, req.expectedVersion));
    })
    .post("/accounts/:accountId/post-drafts/review", authed, async (c) => {
      // 承認・却下・要確認に戻す（specs/004-review-approval contracts/api.md）。全プランで使える（FR-034）
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      const req = await parseBody(reviewRequestSchema, c.req.json());
      return c.json(await reviewDrafts(c.env, account.id, req));
    });
}

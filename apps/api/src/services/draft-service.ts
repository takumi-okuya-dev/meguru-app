// 投稿ストックの下書き（specs/003-prompt-bulk-register research.md R3・R5〜R8）。
// 一覧・一括登録・取り消し・編集・まとめての削除の手順を持つ。下書きの操作は全プランで使える（R10）。
import { NEEDS_REVIEW_LIMIT, findPasteProblem, isOverThreadsLimit, splitDrafts } from "@threads-grower/shared";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../db/client";
import { draftBatches, postDrafts } from "../db/schema";
import type { Env } from "../env";
import { AppError, itemNotFound, notFound, pgErrorCode } from "../lib/errors";
import { updateWithVersion } from "./item-service";

type PostDraftRow = typeof postDrafts.$inferSelect;

/**
 * 下書きの行を、レスポンスの PostDraft にする。
 * @param row - post_drafts の行
 * @returns PostDraft
 */
export function toPostDraft(row: PostDraftRow) {
  return {
    id: row.id,
    batchId: row.batchId,
    position: row.position,
    body: row.body,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 要確認の下書きの一覧（FR-018）。登録のまとまりの新しい順 → まとまりの中は貼り付けた順。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param limit - 取得する最大件数（省略するとすべて）
 * @returns 下書きの行
 */
export async function listDraftRows(db: Db | TxDb, accountId: string, limit?: number): Promise<PostDraftRow[]> {
  const query = db
    .select({ draft: postDrafts })
    .from(postDrafts)
    .innerJoin(draftBatches, eq(draftBatches.id, postDrafts.batchId))
    .where(and(eq(postDrafts.accountId, accountId), eq(postDrafts.status, "needs_review")))
    .orderBy(desc(draftBatches.createdAt), desc(draftBatches.id), asc(postDrafts.position));
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map((r) => r.draft);
}

type BatchRow = typeof draftBatches.$inferSelect;

function toBatchResult(batch: BatchRow, drafts: PostDraftRow[]) {
  return {
    batchId: batch.id,
    draftCount: batch.draftCount,
    delimiterFound: batch.delimiterFound,
    overLimitCount: drafts.filter((d) => isOverThreadsLimit(d.body)).length,
    drafts: drafts.map(toPostDraft),
  };
}

/**
 * 貼り付けたテキストを分けて、要確認の下書きとして一括登録する（FR-009〜FR-016、research.md R3・R5・R6）。
 * 全件を登録するか、何も登録しないかのどちらかにする。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param req - clientRequestId：送信ごとのID（再試行では同じ値）、text：貼り付けたテキスト
 * @returns created：新しく登録したか（false は同じ clientRequestId の2回目）、result：DraftBatchResult
 * @throws AppError VALIDATION_FAILED（下書きが0件）、PASTE_TOO_LARGE（1回の上限を超える）、
 *   ITEM_LIMIT_REACHED（要確認が500件を超える）、ACCOUNT_NOT_FOUND（登録の途中でAccountが削除された）
 */
export async function createDraftBatch(env: Env, accountId: string, req: { clientRequestId: string; text: string }) {
  const { parts, delimiterFound } = splitDrafts(req.text);
  if (parts.length === 0) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["text"]);
  const problem = findPasteProblem(req.text, parts);
  if (problem) throw new AppError("PASTE_TOO_LARGE", 400, "paste too large", undefined, [problem]);

  try {
    return await withTransaction(env.DATABASE_URL, async (tx) => {
      // 「Account × 下書き」単位で直列化してから数える（同時の登録でも500件を超えない）
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account_items:${accountId}:post_drafts`}, 0))`);
      const [existing] = await tx
        .select()
        .from(draftBatches)
        .where(and(eq(draftBatches.accountId, accountId), eq(draftBatches.clientRequestId, req.clientRequestId)))
        .limit(1);
      if (existing) {
        const remaining = await tx
          .select()
          .from(postDrafts)
          .where(and(eq(postDrafts.batchId, existing.id), eq(postDrafts.status, "needs_review")))
          .orderBy(asc(postDrafts.position));
        return { created: false, result: toBatchResult(existing, remaining) };
      }
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(postDrafts)
        .where(and(eq(postDrafts.accountId, accountId), eq(postDrafts.status, "needs_review")))) as [{ n: number }];
      if (n + parts.length > NEEDS_REVIEW_LIMIT) throw new AppError("ITEM_LIMIT_REACHED", 409, "item limit reached");
      const [batch] = await tx
        .insert(draftBatches)
        .values({ accountId, clientRequestId: req.clientRequestId, draftCount: parts.length, delimiterFound })
        .returning();
      const drafts = await tx
        .insert(postDrafts)
        .values(parts.map((body, position) => ({ accountId, batchId: batch!.id, position, body })))
        .returning();
      drafts.sort((a, b) => a.position - b.position);
      return { created: true, result: toBatchResult(batch!, drafts) };
    });
  } catch (err) {
    // 外部キー違反：登録の途中でAccountが削除された
    if (pgErrorCode(err) === "23503") throw notFound();
    throw err;
  }
}

/**
 * 登録を取り消す（FR-016a、research.md R8）。その登録の要確認の下書きだけを削除し、登録のまとまりの行は残す。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param batchId - draft_batches.id（UUID の形は確かめてあること）
 * @returns 削除した件数（すでに消えていれば0）
 * @throws AppError ITEM_NOT_FOUND（登録のまとまりがない、または別のAccountのもの）
 */
export async function deleteBatch(db: Db, accountId: string, batchId: string): Promise<number> {
  const [batch] = await db
    .select({ id: draftBatches.id })
    .from(draftBatches)
    .where(and(eq(draftBatches.id, batchId), eq(draftBatches.accountId, accountId)))
    .limit(1);
  if (!batch) throw itemNotFound();
  const deleted = await db
    .delete(postDrafts)
    .where(and(eq(postDrafts.batchId, batchId), eq(postDrafts.accountId, accountId), eq(postDrafts.status, "needs_review")))
    .returning({ id: postDrafts.id });
  return deleted.length;
}

/**
 * 下書きの本文を編集する（FR-019）。要確認の下書きだけを対象にし、本文の前後の空白を除いて保存する。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param id - post_drafts.id（UUID の形は確かめてあること）
 * @param req - body：新しい本文、expectedVersion：読み込んだときの version
 * @returns 更新した PostDraft
 * @throws AppError STALE_UPDATE（他で先に更新された。latest 付き）、ITEM_NOT_FOUND（ない・別のAccountのもの）
 */
export async function updateDraft(db: Db, accountId: string, id: string, req: { body: string; expectedVersion: number }) {
  const mine = and(eq(postDrafts.id, id), eq(postDrafts.accountId, accountId), eq(postDrafts.status, "needs_review"));
  const row = await updateWithVersion(
    () =>
      db
        .update(postDrafts)
        .set({ body: req.body.trim(), version: sql`${postDrafts.version} + 1`, updatedAt: new Date() })
        .where(and(mine, eq(postDrafts.version, req.expectedVersion)))
        .returning(),
    async () => (await db.select().from(postDrafts).where(mine).limit(1))[0],
    toPostDraft,
  );
  return toPostDraft(row);
}

/**
 * 下書きをまとめて削除する（FR-020）。そのAccountの要確認の下書きだけを消し、それ以外のIDは無視する。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param ids - post_drafts.id の一覧（UUID の形は確かめてあること）
 * @returns 削除した件数
 */
export async function deleteDrafts(db: Db, accountId: string, ids: string[]): Promise<number> {
  const deleted = await db
    .delete(postDrafts)
    .where(and(inArray(postDrafts.id, ids), eq(postDrafts.accountId, accountId), eq(postDrafts.status, "needs_review")))
    .returning({ id: postDrafts.id });
  return deleted.length;
}

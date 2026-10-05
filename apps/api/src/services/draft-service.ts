// 投稿ストックの下書き（specs/003-prompt-bulk-register research.md R3・R5〜R8）。
// 一覧・一括登録・取り消し・編集・まとめての削除の手順を持つ。下書きの操作は全プランで使える（R10）。
import {
  NEEDS_REVIEW_LIMIT,
  REJECTED_LIST_MAX,
  findPasteProblem,
  isOverThreadsLimit,
  splitDrafts,
  type BlockedReason,
  type DraftCounts,
  type PublishError,
  type RejectReasonCode,
} from "@threads-grower/shared";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../db/client";
import { lockAccountDrafts } from "../db/locks";
import { draftBatches, postDrafts } from "../db/schema";
import type { Env } from "../env";
import { AppError, itemNotFound, notFound, pgErrorCode } from "../lib/errors";
import type { AccountRow } from "./access";
import { updateWithVersion } from "./item-service";
import { readPostingSchedule, toAutoPostState } from "./posting-schedule-service";

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
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectReasons: (row.rejectReasons ?? []) as RejectReasonCode[],
    rejectNote: row.rejectNote,
    // 自動投稿（specs/005-auto-post data-model.md）
    prioritizedAt: row.prioritizedAt?.toISOString() ?? null,
    carryover: row.carryoverAttemptId !== null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    threadsMediaId: row.threadsMediaId,
    threadsPermalink: row.threadsPermalink,
    publishFailedAt: row.publishFailedAt?.toISOString() ?? null,
    publishError: row.publishError as PublishError | null,
    blockedAt: row.blockedAt?.toISOString() ?? null,
    blockedReason: row.blockedReason as BlockedReason | null,
    blockedWords: row.blockedWords ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 要確認に戻すときに消す列（specs/005-auto-post data-model.md「状態と記録の組み合わせ」）。
 * 要確認では、投稿の順（次に投稿する・持ち越し）の記録を持たない（FR-005a）。
 */
export const CLEAR_QUEUE_FIELDS = { prioritizedAt: null, carryoverAttemptId: null } as const;

/** 投稿の直前のチェックの記録を消す列（状態が変わったら消す。005 FR-007）。 */
export const CLEAR_BLOCKED_FIELDS = { blockedAt: null, blockedReason: null, blockedWords: null } as const;

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

/**
 * 状態ごとの下書きの件数（FR-001・FR-013、005 FR-020・FR-023）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 要確認・承認済み（投稿の処理中を含む）・却下・投稿済み・投稿に失敗の件数
 */
export async function countDrafts(db: Db | TxDb, accountId: string): Promise<DraftCounts> {
  const rows = await db
    .select({ status: postDrafts.status, n: count() })
    .from(postDrafts)
    .where(eq(postDrafts.accountId, accountId))
    .groupBy(postDrafts.status);
  const n = (status: PostDraftRow["status"]) => Number(rows.find((r) => r.status === status)?.n ?? 0);
  return {
    needsReview: n("needs_review"),
    approved: n("approved") + n("publishing"),
    rejected: n("rejected"),
    published: n("published"),
    publishFailed: n("publish_failed"),
  };
}

/**
 * 承認済みの下書きを、投稿の順に読む（005 research.md R4。packages/shared の compareQueueOrder と同じ並び）。
 * 処理中 → 持ち越し → 「次に投稿する」の新しい順 → 承認した古い順 → id の順。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param opts - includePublishing：処理中も含めるか（一覧は含める。取り出しは含めない）
 * @returns 下書きの行
 */
export async function listQueueRows(
  db: Db | TxDb,
  accountId: string,
  opts: { includePublishing: boolean } = { includePublishing: true },
): Promise<PostDraftRow[]> {
  return db
    .select()
    .from(postDrafts)
    .where(
      and(
        eq(postDrafts.accountId, accountId),
        inArray(postDrafts.status, opts.includePublishing ? ["approved", "publishing"] : ["approved"]),
      ),
    )
    .orderBy(
      sql`(${postDrafts.status}::text = 'publishing') DESC`,
      sql`(${postDrafts.carryoverAttemptId} IS NOT NULL) DESC`,
      sql`${postDrafts.prioritizedAt} DESC NULLS LAST`,
      asc(postDrafts.reviewedAt),
      asc(postDrafts.id),
    );
}

/**
 * 投稿に失敗の下書きを、失敗した日時の新しい順にすべて読む（005 FR-021）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 下書きの行
 */
export async function listPublishFailedRows(db: Db | TxDb, accountId: string): Promise<PostDraftRow[]> {
  return db
    .select()
    .from(postDrafts)
    .where(and(eq(postDrafts.accountId, accountId), eq(postDrafts.status, "publish_failed")))
    .orderBy(desc(postDrafts.publishFailedAt), desc(postDrafts.id));
}

/**
 * 承認済み・却下の下書きを、承認・却下した日時の新しい順に読む（FR-012）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param status - approved か rejected
 * @param limit - 取得する最大件数（省略するとすべて）
 * @returns 下書きの行
 */
export async function listReviewedRows(
  db: Db | TxDb,
  accountId: string,
  status: "approved" | "rejected",
  limit?: number,
): Promise<PostDraftRow[]> {
  const query = db
    .select()
    .from(postDrafts)
    .where(and(eq(postDrafts.accountId, accountId), eq(postDrafts.status, status)))
    .orderBy(desc(postDrafts.reviewedAt), desc(postDrafts.id));
  return limit === undefined ? await query : await query.limit(limit);
}

/**
 * 投稿ストックの下書きと件数をまとめて読む（GET /post-drafts。004 research.md R9、005 research.md R10）。
 * 投稿済みは返さない（タブを開いたときだけ別のAPIで読む。005 research.md R14）。
 * @param db - データベース
 * @param account - Account の行（自動投稿の停止の理由に、接続の状態を使う）
 * @param now - 今の時刻
 * @returns 要確認・承認済み（投稿の順）・却下（新しい500件）・投稿に失敗の下書き、予定、自動投稿の状態、件数
 */
export async function listAllDrafts(db: Db, account: AccountRow, now: Date = new Date()) {
  const [needsReview, approved, rejected, publishFailed, counts, schedule] = await Promise.all([
    listDraftRows(db, account.id),
    listQueueRows(db, account.id),
    listReviewedRows(db, account.id, "rejected", REJECTED_LIST_MAX),
    listPublishFailedRows(db, account.id),
    countDrafts(db, account.id),
    readPostingSchedule(db, account.id),
  ]);
  return {
    needsReview: needsReview.map(toPostDraft),
    approved: approved.map(toPostDraft),
    rejected: rejected.map(toPostDraft),
    publishFailed: publishFailed.map(toPostDraft),
    // 予定の計算は 005 US4 で足す
    schedule: {} as Record<string, string>,
    autoPost: toAutoPostState(account, schedule, now),
    counts,
  };
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
      await lockAccountDrafts(tx, accountId);
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
 * 下書きの本文を編集する（003 FR-019、004 FR-007、research.md R5）。要確認と承認済みの下書きを対象にし、
 * 本文の前後の空白を除いて保存する。承認済みの下書きは、同じ更新で要確認に戻す（直した本文はもう一度承認が要る）。
 * 状態の変更・NGワードの追加と同じロックで直列化する。要確認の件数の上限は確かめない（編集中に保存できないのを避ける）。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param id - post_drafts.id（UUID の形は確かめてあること）
 * @param req - body：新しい本文、expectedVersion：読み込んだときの version
 * @returns draft：更新した PostDraft、reopened：承認済みから要確認に戻したか
 * @throws AppError STALE_UPDATE（他で先に更新された。latest 付き）、ITEM_NOT_FOUND（ない・別のAccountのもの・却下の下書き）
 */
export async function updateDraft(env: Env, accountId: string, id: string, req: { body: string; expectedVersion: number }) {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockAccountDrafts(tx, accountId);
    const mine = and(
      eq(postDrafts.id, id),
      eq(postDrafts.accountId, accountId),
      inArray(postDrafts.status, ["needs_review", "approved"]),
    );
    const [before] = await tx.select({ status: postDrafts.status }).from(postDrafts).where(mine).limit(1);
    const row = await updateWithVersion(
      () =>
        tx
          .update(postDrafts)
          .set({
            body: req.body.trim(),
            status: "needs_review",
            reviewedAt: null,
            lastReviewRequestId: null,
            // 要確認では、投稿の順と直前のチェックの記録を持たない（005 data-model.md）
            ...CLEAR_QUEUE_FIELDS,
            ...CLEAR_BLOCKED_FIELDS,
            version: sql`${postDrafts.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(mine, eq(postDrafts.version, req.expectedVersion)))
          .returning(),
      async () => (await tx.select().from(postDrafts).where(mine).limit(1))[0],
      toPostDraft,
    );
    return { draft: toPostDraft(row), reopened: before?.status === "approved" };
  });
}

/**
 * 下書きをまとめて削除する（003 FR-020、004 FR-009）。そのAccountの要確認と却下の下書きを消し、それ以外のIDは無視する。
 * 承認済みの下書きは、要確認に戻してから削除する。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param ids - post_drafts.id の一覧（UUID の形は確かめてあること）
 * @returns 削除した件数
 */
export async function deleteDrafts(db: Db, accountId: string, ids: string[]): Promise<number> {
  const deleted = await db
    .delete(postDrafts)
    .where(
      and(
        inArray(postDrafts.id, ids),
        eq(postDrafts.accountId, accountId),
        inArray(postDrafts.status, ["needs_review", "rejected"]),
      ),
    )
    .returning({ id: postDrafts.id });
  return deleted.length;
}

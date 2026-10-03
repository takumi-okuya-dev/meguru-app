// 投稿ストックの下書き（specs/003-prompt-bulk-register research.md R3・R5〜R8）。
// 一覧・一括登録・取り消し・編集・まとめての削除の手順を持つ。下書きの操作は全プランで使える（R10）。
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { draftBatches, postDrafts } from "../db/schema";

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

// 下書きの状態の変更：承認・却下・要確認に戻す（specs/004-review-approval contracts/api.md、research.md R2・R3）。
// 承認のチェックはここで行い、Webの判定には頼らない（Constitution原則I・II）。
import {
  APPROVED_LIMIT,
  NEEDS_REVIEW_LIMIT,
  checkPublishable,
  type PostDraft,
  type ReviewRequest,
  type SkipReason,
} from "@threads-grower/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type TxDb } from "../db/client";
import { lockAccountDrafts } from "../db/locks";
import { postDrafts } from "../db/schema";
import type { Env } from "../env";
import { notFound, pgErrorCode } from "../lib/errors";
import { countDrafts, toPostDraft } from "./draft-service";
import { listNgWords } from "./posting-rules-service";

type PostDraftRow = typeof postDrafts.$inferSelect;
type Status = PostDraftRow["status"];

/** 操作ごとの目的の状態。 */
const TARGET: Record<ReviewRequest["action"], Status> = {
  approve: "approved",
  reject: "rejected",
  reopen: "needs_review",
};

/** 操作ごとの、移れる元の状態。 */
const FROM: Record<ReviewRequest["action"], Status[]> = {
  approve: ["needs_review"],
  reject: ["needs_review"],
  reopen: ["approved", "rejected"],
};

/**
 * 状態を変える。1回の UPDATE で、表示していた版（version）の行だけを変える。
 * @param tx - トランザクション
 * @param accountId - accounts.id
 * @param req - リクエスト
 * @param targets - 変える行
 * @returns 変えた行
 */
async function applyChange(tx: TxDb, accountId: string, req: ReviewRequest, targets: PostDraftRow[]) {
  if (targets.length === 0) return [];
  const now = new Date();
  const record =
    req.action === "approve"
      ? { reviewedAt: now, rejectReasons: null, rejectNote: null }
      : req.action === "reject"
        ? {
            reviewedAt: now,
            rejectReasons: req.reject!.reasons.length > 0 ? req.reject!.reasons : null,
            rejectNote: req.reject!.note.trim() === "" ? null : req.reject!.note.trim(),
          }
        : { reviewedAt: null, rejectReasons: null, rejectNote: null };
  // 行ごとに expectedVersion が違うので、(id, version) の組で絞る
  const pairs = sql.join(
    targets.map((t) => sql`(${t.id}::uuid, ${t.version}::int)`),
    sql`, `,
  );
  return tx
    .update(postDrafts)
    .set({ status: TARGET[req.action], ...record, version: sql`${postDrafts.version} + 1`, updatedAt: now })
    .where(and(eq(postDrafts.accountId, accountId), sql`(${postDrafts.id}, ${postDrafts.version}) IN (${pairs})`))
    .returning();
}

/**
 * 下書きの状態を、1件でもまとめてでも変える（FR-002〜FR-006・FR-010、contracts/api.md「POST /post-drafts/review」）。
 * すでに目的の状態にある下書きは何もせず updated に入れる（再試行・連打で二重に記録しない）。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param req - リクエスト（スキーマで確かめてあること）
 * @returns updated：状態を変えた（またはすでに目的の状態だった）下書き、skipped：変えなかった下書きと理由、counts：変えた後の件数
 * @throws AppError ACCOUNT_NOT_FOUND（処理の途中でAccountが削除された）
 */
export async function reviewDrafts(env: Env, accountId: string, req: ReviewRequest) {
  try {
    return await withTransaction(env.DATABASE_URL, async (tx) => {
      // NGワードの追加と同じロックで直列化する（承認とNGワードの追加が同時でも、NGワードを含む承認済みを残さない。R3）
      await lockAccountDrafts(tx, accountId);
      const ids = req.items.map((i) => i.id);
      const [rows, ngWordRows, counts] = await Promise.all([
        tx
          .select()
          .from(postDrafts)
          .where(and(eq(postDrafts.accountId, accountId), inArray(postDrafts.id, ids))),
        req.action === "approve" ? listNgWords(tx, accountId) : Promise.resolve([]),
        countDrafts(tx, accountId),
      ]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const target = TARGET[req.action];
      const updated = new Map<string, PostDraft>();
      const skipped: { id: string; reason: SkipReason; latest?: PostDraft }[] = [];
      const toChange: PostDraftRow[] = [];
      // 上限は、この送信で先に変えた分も含めて数える
      let approved = counts.approved;
      let needsReview = counts.needsReview;

      for (const { id, expectedVersion } of req.items) {
        const row = byId.get(id);
        if (!row) {
          skipped.push({ id, reason: "NOT_FOUND" });
          continue;
        }
        const skip = (reason: SkipReason) => skipped.push({ id, reason, latest: toPostDraft(row) });
        if (row.status === target) {
          updated.set(id, toPostDraft(row));
          continue;
        }
        if (row.version !== expectedVersion || !FROM[req.action].includes(row.status)) {
          skip("STALE");
          continue;
        }
        if (req.action === "approve") {
          const check = checkPublishable(row.body, ngWordRows);
          if (check.ngWords.length > 0) {
            skip("NG_WORD");
            continue;
          }
          if (check.overThreadsLimit) {
            skip("OVER_THREADS_LIMIT");
            continue;
          }
          if (approved + 1 > APPROVED_LIMIT) {
            skip("LIMIT");
            continue;
          }
          approved += 1;
        }
        if (req.action === "reopen") {
          if (needsReview + 1 > NEEDS_REVIEW_LIMIT) {
            skip("LIMIT");
            continue;
          }
          needsReview += 1;
        }
        toChange.push(row);
      }

      const changed = await applyChange(tx, accountId, req, toChange);
      for (const row of changed) updated.set(row.id, toPostDraft(row));
      // ロックの中で読んだ行なので、通常は全件変わる。変わらなかった行（同時の更新）は STALE にする
      for (const row of toChange) {
        if (!updated.has(row.id)) skipped.push({ id: row.id, reason: "STALE", latest: toPostDraft(row) });
      }
      return {
        updated: req.items.map((i) => updated.get(i.id)).filter((d): d is PostDraft => d !== undefined),
        skipped,
        counts: await countDrafts(tx, accountId),
      };
    });
  } catch (err) {
    // 外部キー違反：処理の途中でAccountが削除された
    if (pgErrorCode(err) === "23503") throw notFound();
    throw err;
  }
}

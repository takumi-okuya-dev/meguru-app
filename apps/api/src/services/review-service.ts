// 下書きの状態の変更：承認・却下・要確認に戻す（specs/004-review-approval contracts/api.md、research.md R2・R3）。
// 承認のチェックはここで行い、Webの判定には頼らない（Constitution原則I・II）。
import {
  APPROVED_LIMIT,
  NEEDS_REVIEW_LIMIT,
  checkPublishable,
  type PostDraft,
  type PublishCheck,
  type ReviewRequest,
  type SkipReason,
} from "@threads-grower/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type TxDb } from "../kernel/db/client";
import { lockAccountDrafts } from "../kernel/db/locks";
import { postDrafts, postMentions } from "../db/schema";
import type { Env } from "../kernel/env";
import { notFound, pgErrorCode } from "../kernel/errors";
import {
  CLEAR_BLOCKED_FIELDS,
  CLEAR_QUEUE_FIELDS,
  countDrafts,
  toPostDraft,
} from "./draft-service";
import { listNgWords } from "./posting-rules-service";
import type { AccountAccess } from "./access";
import { recordActivity } from "./activity-log";
import { pendingMentionTexts } from "./mention-service";
import { loadMentions } from "./mention-view";
import { notifyWake } from "./posting-schedule-service";

/**
 * 下書きの本文と返信の文の確かめを1つにする（どちらかに当たれば当たり）。
 * @param body - 本文の確かめ
 * @param reply - 返信の文の確かめ（なければ null）
 * @returns まとめた確かめ
 */
function mergeChecks(body: PublishCheck, reply: PublishCheck | null): PublishCheck {
  if (!reply) return body;
  return {
    ngWords: [...body.ngWords, ...reply.ngWords],
    overThreadsLimit: body.overThreadsLimit || reply.overThreadsLimit,
    policyCautions: [...body.policyCautions, ...reply.policyCautions],
    approvable: body.approvable && reply.approvable,
  };
}

type PostDraftRow = typeof postDrafts.$inferSelect;
type Status = PostDraftRow["status"];

/** 操作ごとの目的の状態。 */
const TARGET: Record<ReviewRequest["action"], Status> = {
  approve: "approved",
  reject: "rejected",
  reopen: "needs_review",
  requeue: "approved",
};

/** 操作ごとの、移れる元の状態。 */
const FROM: Record<ReviewRequest["action"], Status[]> = {
  approve: ["needs_review"],
  reject: ["needs_review"],
  reopen: ["approved", "rejected", "publish_failed"],
  // 投稿に失敗 → 承認済み（もう一度投稿の順に入れる。005 FR-015）
  requeue: ["publish_failed"],
};

/** 投稿に失敗の記録を消す列（005 data-model.md）。 */
const CLEAR_FAILURE_FIELDS = { publishFailedAt: null, publishError: null } as const;

/**
 * 状態を変える。1回の UPDATE で、表示していた版（version）の行だけを変える。
 * @param tx - トランザクション
 * @param accountId - accounts.id
 * @param req - リクエスト
 * @param targets - 変える行
 * @returns 変えた行
 */
async function applyChange(
  tx: TxDb,
  accountId: string,
  req: ReviewRequest,
  targets: PostDraftRow[],
) {
  if (targets.length === 0) return [];
  const now = new Date();
  // 005：要確認からの承認・却下では直前のチェックの記録を消し、要確認に戻すときは投稿の順と失敗の記録も消す。
  // requeue は reviewed_at を元のまま残し、投稿の順の先頭に入れる（data-model.md、research.md R4）
  const record =
    req.action === "approve"
      ? { reviewedAt: now, rejectReasons: null, rejectNote: null, ...CLEAR_BLOCKED_FIELDS }
      : req.action === "reject"
        ? {
            reviewedAt: now,
            rejectReasons: req.reject!.reasons.length > 0 ? req.reject!.reasons : null,
            rejectNote: req.reject!.note.trim() === "" ? null : req.reject!.note.trim(),
            ...CLEAR_BLOCKED_FIELDS,
          }
        : req.action === "requeue"
          ? { prioritizedAt: now, ...CLEAR_FAILURE_FIELDS }
          : {
              reviewedAt: null,
              rejectReasons: null,
              rejectNote: null,
              ...CLEAR_QUEUE_FIELDS,
              ...CLEAR_FAILURE_FIELDS,
            };
  // 行ごとに expectedVersion が違うので、(id, version) の組で絞る
  const pairs = sql.join(
    targets.map((t) => sql`(${t.id}::uuid, ${t.version}::int)`),
    sql`, `,
  );
  return tx
    .update(postDrafts)
    .set({
      status: TARGET[req.action],
      ...record,
      // 自分の再試行を見分けるため、変えた操作のIDを残す（R2）
      lastReviewRequestId: req.requestId,
      version: sql`${postDrafts.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(postDrafts.accountId, accountId),
        sql`(${postDrafts.id}, ${postDrafts.version}) IN (${pairs})`,
      ),
    )
    .returning();
}

/** 操作の記録のコード（specs/008 contracts/api.md「操作の記録のコード」）。 */
const REVIEW_ACTIONS = {
  approve: "drafts_approved",
  reject: "drafts_rejected",
  reopen: "drafts_reopened",
  requeue: "drafts_requeued",
} as const;

/**
 * 下書きの状態を、1件でもまとめてでも変える（FR-002〜FR-006・FR-010、contracts/api.md「POST /post-drafts/review」）。
 * 同じ操作（requestId）の再試行で、すでにその操作で目的の状態になっている下書きは、何もせず updated に入れる
 * （二重に記録しない）。別の操作で目的の状態になっていたものは STALE にする（別タブでの操作を「元に戻す」で
 * 取り消せないようにする。PR #5 のCodexレビュー）。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param req - リクエスト（スキーマで確かめてあること）
 * @param access - 操作した人（操作の記録と、保存した人に使う。specs/008）。省略すると記録しない
 * @returns updated：状態を変えた（またはすでに目的の状態だった）下書き、skipped：変えなかった下書きと理由、counts：変えた後の件数
 * @throws AppError ACCOUNT_NOT_FOUND（処理の途中でAccountが削除された）
 */
export async function reviewDrafts(env: Env, accountId: string, req: ReviewRequest, access?: AccountAccess) {
  let wake = false;
  try {
    const result = await withTransaction(env.DATABASE_URL, async (tx) => {
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
      // 時間差のメンションの返信の文も、下書きと一緒に承認する（specs/023 research.md R5、原則I・II）
      const mentionTexts = await pendingMentionTexts(tx, ids);
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
        // 投稿の処理中の下書きは変えない（005 FR-008）
        if (row.status === "publishing") {
          skip("PUBLISHING");
          continue;
        }
        if (row.status === target) {
          if (row.lastReviewRequestId === req.requestId) updated.set(id, toPostDraft(row));
          else skip("STALE");
          continue;
        }
        if (row.version !== expectedVersion || !FROM[req.action].includes(row.status)) {
          skip("STALE");
          continue;
        }
        if (req.action === "approve") {
          const reply = mentionTexts.get(id);
          const check = mergeChecks(checkPublishable(row.body, ngWordRows), reply === undefined ? null : checkPublishable(reply, ngWordRows));
          if (check.ngWords.length > 0) {
            skip("NG_WORD");
            continue;
          }
          if (check.overThreadsLimit) {
            skip("OVER_THREADS_LIMIT");
            continue;
          }
          // 規約に注意は承認を止めないが、Webで確認を経ていない承認は受け付けない（FR-040）
          if (check.policyCautions.length > 0 && req.confirmPolicyCaution !== true) {
            skip("POLICY_CONFIRM_REQUIRED");
            continue;
          }
          if (approved + 1 > APPROVED_LIMIT) {
            skip("LIMIT");
            continue;
          }
          approved += 1;
        }
        if (req.action === "requeue") {
          // 承認済みの上限は、requeue でも数える（005 research.md R4）
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
      // 却下した下書きの時間差のメンションは消す（specs/023 data-model.md「状態」）
      if (req.action === "reject" && changed.length > 0)
        await tx.delete(postMentions).where(inArray(postMentions.draftId, changed.map((r) => r.id)));
      if (req.action === "approve" && changed.some((r) => mentionTexts.has(r.id))) wake = true;
      const mentions = await loadMentions(tx, changed, access?.account.username ?? null);
      for (const row of changed) updated.set(row.id, toPostDraft(row, { mentions }));
      // 1回の操作を1行で記録する（specs/008 FR-050a）。同じ requestId の再試行では changed が空なので書かない
      if (access && changed.length > 0) {
        await recordActivity(tx, access, {
          kind: "review",
          action: REVIEW_ACTIONS[req.action],
          itemCount: changed.length,
          excerpts: changed.map((r) => r.body),
          ...(req.action === "reject" && req.reject
            ? { details: { reasons: req.reject.reasons, note: req.reject.note ?? null } }
            : {}),
        });
      }
      // ロックの中で読んだ行なので、通常は全件変わる。変わらなかった行（同時の更新）は STALE にする
      for (const row of toChange) {
        if (!updated.has(row.id))
          skipped.push({ id: row.id, reason: "STALE", latest: toPostDraft(row) });
      }
      return {
        updated: req.items
          .map((i) => updated.get(i.id))
          .filter((d): d is PostDraft => d !== undefined),
        skipped,
        counts: await countDrafts(tx, accountId),
      };
    });
    // 時間差のメンションの付いた下書きを承認したら、関所を起こす（specs/023 research.md R2）
    if (wake) await notifyWake(env.AUTOPOST_KV, new Date());
    return result;
  } catch (err) {
    // 外部キー違反：処理の途中でAccountが削除された
    if (pgErrorCode(err) === "23503") throw notFound();
    throw err;
  }
}

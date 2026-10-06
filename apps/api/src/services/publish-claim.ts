// 取り出し（specs/005-auto-post contracts/auto-post-job.md 手順2の4・手順3、research.md R6・R7）。
// 来ている時刻の試みの行を作り、同じトランザクションで、公開する下書きを選んで publishing にする。
// 004 の承認・NGワードの追加と同じ「Account × 下書き」のロックの中で、その時点のNGワードで確かめる（Constitution原則I）。
import {
  AUTOPOST_DAILY_API_LIMIT,
  AUTOPOST_LEASE_SECONDS,
  addDays,
  checkPublishable,
  jstMidnight,
  jstDateOf,
  type DueSlot,
} from "@threads-grower/shared";
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withTransaction, type TxDb } from "../db/client";
import { lockAccountDrafts } from "../db/locks";
import { accounts, postDrafts, postingSchedules, publishAttempts } from "../db/schema";
import type { Env } from "../env";
import { CLEAR_QUEUE_FIELDS, listQueueRows } from "./draft-service";
import { readPostingSchedule } from "./posting-schedule-service";
import { listNgWords } from "./posting-rules-service";

/** 飛ばした理由（publish_attempts.skip_reason）。 */
export type SkipReason =
  "no_drafts" | "needs_reconnect" | "rate_limited" | "daily_limit" | "auto_post_off";

/** 取り出しの結果。 */
export type ClaimResult =
  | { kind: "exists" }
  | { kind: "waiting" }
  | { kind: "skipped"; attemptId: string; reason: SkipReason; blocked: number }
  | { kind: "claimed"; attemptId: string; draftId: string; blocked: number };

/**
 * 公開してよいかの条件を確かめる（手順3の表）。満たさなければ飛ばす理由を返す。
 * @param tx - トランザクション
 * @param accountId - accounts.id
 * @param slot - 来ている時刻
 * @param now - 今の時刻
 * @returns 飛ばす理由。満たしていれば null
 */
async function skipReasonOf(
  tx: TxDb,
  accountId: string,
  slot: DueSlot,
  now: Date,
): Promise<SkipReason | null> {
  const [schedule, [account]] = await Promise.all([
    readPostingSchedule(tx, accountId),
    tx
      .select({ connectionStatus: accounts.connectionStatus })
      .from(accounts)
      .where(eq(accounts.id, accountId)),
  ]);
  if (!schedule?.enabled) return "auto_post_off";
  if (account?.connectionStatus !== "connected") return "needs_reconnect";
  if (schedule.pausedUntil && schedule.pausedUntil.getTime() > now.getTime()) return "rate_limited";
  const published = (from: Date, to: Date) =>
    tx
      .select({ n: count() })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.accountId, accountId),
          eq(postDrafts.status, "published"),
          gte(postDrafts.publishedAt, from),
          lt(postDrafts.publishedAt, to),
        ),
      );
  const [[day], [last24h]] = await Promise.all([
    published(jstMidnight(slot.slotDate), jstMidnight(addDays(slot.slotDate, 1))),
    published(new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 1)),
  ]);
  // その日の投稿数は時刻の数まで（SC-008）。24時間で250件を超えない（FR-017）
  if (Number(day?.n ?? 0) >= schedule.slotMinutes.length) return "daily_limit";
  if (Number(last24h?.n ?? 0) >= AUTOPOST_DAILY_API_LIMIT) return "rate_limited";
  return null;
}

/**
 * 来ている時刻の試みを作り、公開する下書きを選ぶ（手順2の4・手順3）。
 * - 同じ時刻の行がすでにあれば何もしない（同じ時刻を二重に処理しない）
 * - 同じAccountに処理中・やり直し待ちの試みがあれば、行を作らずに待つ（research.md R6「1つずつ進める」）
 * - 投稿の順の先頭から checkPublishable で確かめ、当たった下書きは要確認に戻す（FR-007）。規約に注意では止めない
 * @param env - Workers のバインディング
 * @param accountId - accounts.id
 * @param slot - 来ている時刻
 * @param now - 今の時刻
 * @returns exists・waiting・skipped（理由）・claimed（下書き）。blocked は要確認に戻した件数
 */
export async function claimSlot(
  env: Env,
  accountId: string,
  slot: DueSlot,
  now: Date,
): Promise<ClaimResult> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockAccountDrafts(tx, accountId);
    const [existing] = await tx
      .select({ id: publishAttempts.id })
      .from(publishAttempts)
      .where(and(eq(publishAttempts.accountId, accountId), eq(publishAttempts.slotAt, slot.slotAt)))
      .limit(1);
    if (existing) return { kind: "exists" } as const;
    const [pending] = await tx
      .select({ id: publishAttempts.id })
      .from(publishAttempts)
      .where(
        and(
          eq(publishAttempts.accountId, accountId),
          inArray(publishAttempts.state, ["in_progress", "retry_wait"]),
        ),
      )
      .limit(1);
    if (pending) return { kind: "waiting" } as const;

    const base = {
      accountId,
      slotAt: slot.slotAt,
      slotDate: slot.slotDate,
      slotMinute: slot.slotMinute,
      createdAt: now,
      updatedAt: now,
    };
    const skip = async (reason: SkipReason, blocked: number) => {
      const [row] = await tx
        .insert(publishAttempts)
        .values({ ...base, state: "skipped", skipReason: reason })
        .returning({ id: publishAttempts.id });
      return { kind: "skipped", attemptId: row!.id, reason, blocked } as const;
    };

    const reason = await skipReasonOf(tx, accountId, slot, now);
    if (reason) {
      if (reason === "rate_limited") {
        // 自分の記録で250件に達した場合も、APIの上限と同じ停止の知らせを出す。
        await tx
          .update(postingSchedules)
          .set({ pausedUntil: jstMidnight(addDays(jstDateOf(now), 1)) })
          .where(eq(postingSchedules.accountId, accountId));
      }
      return skip(reason, 0);
    }

    const [queue, ngWordRows] = await Promise.all([
      listQueueRows(tx, accountId, { includePublishing: false }),
      listNgWords(tx, accountId),
    ]);
    let blocked = 0;
    for (const draft of queue) {
      const check = checkPublishable(draft.body, ngWordRows);
      if (!check.approvable) {
        // 公開の直前のチェックで当たった：要確認に戻し、理由を残す（FR-007）。要確認の上限は確かめない
        await tx
          .update(postDrafts)
          .set({
            status: "needs_review",
            reviewedAt: null,
            lastReviewRequestId: null,
            ...CLEAR_QUEUE_FIELDS,
            blockedAt: now,
            blockedReason: check.ngWords.length > 0 ? "ng_word" : "over_threads_limit",
            blockedWords:
              check.ngWords.length > 0 ? [...new Set(check.ngWords.map((h) => h.word))] : null,
            version: sql`${postDrafts.version} + 1`,
            updatedAt: now,
          })
          .where(eq(postDrafts.id, draft.id));
        blocked += 1;
        continue;
      }
      const [row] = await tx
        .insert(publishAttempts)
        .values({
          ...base,
          state: "in_progress",
          draftId: draft.id,
          isCarryover: draft.carryoverAttemptId !== null,
          leaseUntil: new Date(now.getTime() + AUTOPOST_LEASE_SECONDS * 1000),
        })
        .returning({ id: publishAttempts.id });
      await tx
        .update(postDrafts)
        .set({
          status: "publishing",
          carryoverAttemptId: null,
          version: sql`${postDrafts.version} + 1`,
          updatedAt: now,
        })
        .where(eq(postDrafts.id, draft.id));
      return { kind: "claimed", attemptId: row!.id, draftId: draft.id, blocked } as const;
    }
    return skip("no_drafts", blocked);
  });
}

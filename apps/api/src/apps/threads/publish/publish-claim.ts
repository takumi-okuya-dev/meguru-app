// 取り出し（specs/005-auto-post contracts/auto-post-job.md 手順2の4・手順3、research.md R6・R7）。
// 来ている時刻の試みの行を作り、同じトランザクションで、公開する下書きを選んで publishing にする。
// 004 の承認・NGワードの追加と同じ「Account × 下書き」のロックの中で、その時点のNGワードで確かめる（Constitution原則I）。
import {
  AUTOPOST_DAILY_API_LIMIT,
  AUTOPOST_LEASE_SECONDS,
  addDays,
  checkPublishable,
  jstMidnight,
  plannedSlotTime,
  type DueSlot,
} from "@meguru/shared";
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withTransaction, type TxDb } from "../../../kernel/db/client";
import { lockAccountDrafts } from "../../../kernel/db/locks";
import { postDrafts, postingSchedules, publishAttempts } from "../schema";
import {
  accounts,
  effectiveSlotMinutes,
  ownerDailyPostLimit,
  loadOwnerEntitlement,
  ownerAutopostOn,
} from "../../../platform";
import type { Env } from "../../../kernel/env";
import { billingModeOf, type BillingMode } from "../../../kernel/config";
import { CLEAR_QUEUE_FIELDS, listQueueRows } from "../drafts/draft-service";
import { listNgWords } from "../drafts/posting-rules-service";

type ScheduleRow = typeof postingSchedules.$inferSelect;

/** 飛ばした理由（publish_attempts.skip_reason）。 */
export type SkipReason =
  "no_drafts" | "needs_reconnect" | "rate_limited" | "daily_limit" | "auto_post_off" | "billing_inactive";

/** 取り出しの結果。 */
export type ClaimResult =
  | { kind: "exists" }
  | { kind: "waiting" }
  | { kind: "stale" }
  | { kind: "skipped"; attemptId: string; reason: SkipReason; blocked: number }
  | { kind: "claimed"; attemptId: string; draftId: string; leaseToken: string; blocked: number };

/**
 * 時刻が、今の設定の時刻のままかを確かめる（FR-012・FR-016）。
 * 定期処理が設定を読んだ後に、設定の変更・再接続で effective_from が進んだり時刻が変わったりしていれば false。
 * @param accountId - accounts.id
 * @param slot - 来ている時刻（定期処理が先に読んだ設定で求めたもの）
 * @param schedule - 取り出しのトランザクションで読み直した設定
 * @param dailyPostLimit - オーナーの1日の投稿数の上限（specs/024）
 * @returns 今の設定でも、この時刻が予定の時刻なら true
 */
function isCurrentSlot(accountId: string, slot: DueSlot, schedule: ScheduleRow, dailyPostLimit: number): boolean {
  return (
    slot.slotAt.getTime() > schedule.effectiveFrom.getTime() &&
    // 1日の投稿数の上限を超えた時刻は、今の設定の予定の時刻ではない（specs/024 FR-020）
    effectiveSlotMinutes(schedule.slotMinutes, dailyPostLimit).includes(slot.slotMinute) &&
    plannedSlotTime(accountId, slot.slotDate, slot.slotMinute, schedule.jitter).getTime() ===
      slot.slotAt.getTime()
  );
}

/**
 * 公開してよいかの条件を確かめる（手順3の表）。満たさなければ飛ばす理由を返す。
 * @param tx - トランザクション
 * @param mode - 決済のモード（オーナーが読むだけなら billing_inactive。specs/013 research.md R8）
 * @param accountId - accounts.id
 * @param schedule - 読み直した設定
 * @param slot - 来ている時刻
 * @param now - 今の時刻
 * @param dailyPostLimit - オーナーの1日の投稿数の上限（specs/024）
 * @returns 飛ばす理由。満たしていれば null
 */
async function skipReasonOf(
  tx: TxDb,
  mode: BillingMode,
  accountId: string,
  schedule: ScheduleRow | undefined,
  slot: DueSlot,
  now: Date,
  dailyPostLimit: number,
): Promise<SkipReason | null> {
  const [account] = await tx
    .select({ connectionStatus: accounts.connectionStatus })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!schedule?.enabled) return "auto_post_off";
  if (account?.connectionStatus !== "connected") return "needs_reconnect";
  // 一覧を読んだ後にオーナーが読むだけになった（specs/013 research.md R8）
  const owner = await loadOwnerEntitlement(tx, accountId, mode, now);
  if (owner && !owner.fullAccess) return "billing_inactive";
  // 一覧を読んだ後に、オーナーが自動投稿を使えなくなった（specs/019 FR-008）
  if (!(await ownerAutopostOn(tx, accountId))) return "auto_post_off";
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
  // その日の投稿数は時刻の数まで（SC-008）、かつオーナーの1日の投稿数の上限まで（specs/024 FR-019）。24時間で250件を超えない（FR-017）
  if (Number(day?.n ?? 0) >= effectiveSlotMinutes(schedule.slotMinutes, dailyPostLimit).length) return "daily_limit";
  if (Number(last24h?.n ?? 0) >= AUTOPOST_DAILY_API_LIMIT) return "rate_limited";
  return null;
}

/**
 * 来ている時刻の試みを作り、公開する下書きを選ぶ（手順2の4・手順3）。
 * - 同じ時刻の行がすでにあれば何もしない（同じ時刻を二重に処理しない）
 * - 同じAccountに処理中・やり直し待ちの試みがあれば、行を作らずに待つ（research.md R6「1つずつ進める」）
 * - 設定を読み直し、時刻が今の設定のものでなくなっていれば、行を作らずに終える（stale。FR-012・FR-016）
 * - 投稿の順の先頭から checkPublishable で確かめ、当たった下書きは要確認に戻す（FR-007）。規約に注意では止めない
 * @param env - Workers のバインディング
 * @param accountId - accounts.id
 * @param slot - 来ている時刻
 * @param now - 今の時刻
 * @returns exists・waiting・stale・skipped（理由）・claimed（下書き）。blocked は要確認に戻した件数
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

    // 設定の行を共有ロックで読み直す。設定の変更・再接続（effective_from を進める更新）は、この取り出しの前か後のどちらかになる
    const [schedule] = await tx
      .select()
      .from(postingSchedules)
      .where(eq(postingSchedules.accountId, accountId))
      .for("share");
    // オーナーの1日の投稿数の上限は、設定と同じトランザクションで読み直す（一覧を読んだ後に下がっても超えない）
    const dailyPostLimit = await ownerDailyPostLimit(tx, accountId, billingModeOf(env).operators ?? []);
    if (schedule?.enabled && !isCurrentSlot(accountId, slot, schedule, dailyPostLimit))
      return { kind: "stale" } as const;

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

    // 自分の記録で250件に達した場合は paused_until を入れない（直前24時間の件数が減れば、次の時刻から投稿する）
    const reason = await skipReasonOf(tx, billingModeOf(env), accountId, schedule, slot, now, dailyPostLimit);
    if (reason) return skip(reason, 0);

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
      const leaseToken = crypto.randomUUID();
      const [row] = await tx
        .insert(publishAttempts)
        .values({
          ...base,
          state: "in_progress",
          draftId: draft.id,
          isCarryover: draft.carryoverAttemptId !== null,
          leaseUntil: new Date(now.getTime() + AUTOPOST_LEASE_SECONDS * 1000),
          leaseToken,
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
      return {
        kind: "claimed",
        attemptId: row!.id,
        draftId: draft.id,
        leaseToken,
        blocked,
      } as const;
    }
    return skip("no_drafts", blocked);
  });
}

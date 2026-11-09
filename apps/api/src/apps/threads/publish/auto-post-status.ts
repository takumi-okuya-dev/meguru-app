// 自動投稿の状態・予定・知らせ（specs/005-auto-post research.md R8・R9、contracts/api.md「GET /auto-post」）。
// 知らせは保存せず、読むたびに今の状態から求める（SC-005）。
import {
  addDays,
  jstDateOf,
  jstMidnight,
  projectSchedule,
  type AutoPostNotice,
  type AutoPostStatus,
} from "@threads-grower/shared";
import { and, count, desc, eq, gt, gte, isNotNull, lt } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { postDrafts, publishAttempts } from "../schema";
import { effectiveSlotMinutes } from "../../../platform";
import type { AccountRow } from "../../../platform";
import { countDrafts, listQueueRows, listPublishFailedRows } from "../drafts/draft-service";
import {
  readPostingSchedule,
  toAutoPostState,
  type PostingScheduleRow,
} from "./posting-schedule-service";

/**
 * 予定の計算（projectSchedule）の材料を読む：今日・昨日に試みの行がある予定の時刻と、今日の投稿済みの件数。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param now - 今の時刻
 * @returns usedSlotTimes・publishedToday
 */
export async function readScheduleUsage(db: Db, accountId: string, now: Date) {
  const today = jstDateOf(now);
  const todayStart = jstMidnight(today);
  const [used, [published]] = await Promise.all([
    db
      .select({ slotAt: publishAttempts.slotAt })
      .from(publishAttempts)
      .where(
        and(
          eq(publishAttempts.accountId, accountId),
          gte(publishAttempts.slotDate, addDays(today, -1)),
        ),
      ),
    db
      .select({ n: count() })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.accountId, accountId),
          eq(postDrafts.status, "published"),
          gte(postDrafts.publishedAt, todayStart),
          lt(postDrafts.publishedAt, jstMidnight(addDays(today, 1))),
        ),
      ),
  ]);
  return { usedSlotTimes: used.map((u) => u.slotAt), publishedToday: Number(published?.n ?? 0) };
}

/**
 * これから先の予定の時刻（research.md R9）。止まっている（要再接続・上限）ときは空。
 * @param db - データベース
 * @param account - Account の行
 * @param schedule - posting_schedules の行
 * @param now - 今の時刻
 * @param n - 求める件数
 * @returns 予定の時刻
 */
export async function upcomingSlots(
  db: Db,
  account: AccountRow & { ownerReadOnly?: boolean; dailyPostLimit?: number },
  schedule: PostingScheduleRow | null,
  now: Date,
  n: number,
) {
  if (!schedule?.enabled || toAutoPostState(account, schedule, now).stoppedReason) return [];
  const usage = await readScheduleUsage(db, account.id, now);
  return projectSchedule({
    accountId: account.id,
    enabled: schedule.enabled,
    // オーナーの1日の投稿数の上限を超えた時刻には投稿しない（早い時刻から上限の数まで。specs/024 FR-020）
    slotMinutes: effectiveSlotMinutes(schedule.slotMinutes, account.dailyPostLimit),
    jitter: schedule.jitter,
    effectiveFrom: schedule.effectiveFrom,
    pausedUntil: schedule.pausedUntil,
    now,
    ...usage,
    count: n,
  });
}

/**
 * 自動投稿の状態と知らせ（GET /auto-post。FR-018・FR-022）。
 * @param db - データベース
 * @param account - Account の行
 * @param now - 今の時刻
 * @returns AutoPostStatus
 */
export async function getAutoPostStatus(
  db: Db,
  account: AccountRow & { ownerReadOnly?: boolean; dailyPostLimit?: number },
  now: Date = new Date(),
): Promise<AutoPostStatus> {
  const [schedule, counts] = await Promise.all([
    readPostingSchedule(db, account.id),
    countDrafts(db, account.id),
  ]);
  const autoPost = toAutoPostState(account, schedule, now);
  const notices: AutoPostNotice[] = [];
  // 未接続なら、承認した案はつないでオンにすると投稿される、と知らせる（specs/012 FR-033）
  if (account.connectionStatus === "not_connected") notices.push({ kind: "not_connected" });
  if (autoPost.enabled && account.connectionStatus === "needs_reconnect")
    notices.push({ kind: "needs_reconnect" });
  if (autoPost.enabled && schedule?.pausedUntil && schedule.pausedUntil > now)
    notices.push({ kind: "rate_limited", until: schedule.pausedUntil.toISOString() });
  const failed = await listPublishFailedRows(db, account.id);
  if (failed.length)
    notices.push({
      kind: "publish_failed",
      count: failed.length,
      latestError: failed[0]!.publishError as
        "network" | "threads_server" | "invalid_request" | "container_error" | "unknown",
      latestAt: failed[0]!.publishFailedAt!.toISOString(),
    });
  const blocked = await db
    .select()
    .from(postDrafts)
    .where(
      and(
        eq(postDrafts.accountId, account.id),
        eq(postDrafts.status, "needs_review"),
        isNotNull(postDrafts.blockedAt),
        schedule?.blockedNoticeSeenAt
          ? gt(postDrafts.blockedAt, schedule.blockedNoticeSeenAt)
          : undefined,
      ),
    )
    .orderBy(desc(postDrafts.blockedAt), desc(postDrafts.id));
  if (blocked.length && blocked[0]!.blockedReason)
    notices.push({
      kind: "blocked",
      count: blocked.length,
      latestReason: blocked[0]!.blockedReason as "ng_word" | "over_threads_limit",
      latestWords: blocked[0]!.blockedWords ?? [],
    });
  if (autoPost.enabled && autoPost.stoppedReason === null && counts.approved === 0) {
    const [next] = await upcomingSlots(db, account, schedule, now, 1);
    notices.push({ kind: "no_approved", nextSlotAt: next?.toISOString() ?? null });
  }
  const queue = (await listQueueRows(db, account.id)).filter((d) => d.status !== "publishing");
  const [at] = await upcomingSlots(db, account, schedule, now, 1);
  const draft = queue[0];
  return {
    autoPost,
    next:
      at && draft
        ? {
            at: at.toISOString(),
            draft: { id: draft.id, excerpt: Array.from(draft.body).slice(0, 40).join("") },
          }
        : null,
    approvedCount: counts.approved,
    daysLeft: autoPost.slotCount ? Math.floor(counts.approved / autoPost.slotCount) : null,
    notices,
  };
}

// 自動投稿の定期処理（specs/005-auto-post contracts/auto-post-job.md 手順0〜7、research.md R3・R6）。
// 5分ごとの Cron で呼ぶ。関所で用のない回はDBに触れずに終える。1回で進める公開は最大4件（Workers Free のサブリクエストの上限）。
import {
  AUTOPOST_LATE_WARN_MINUTES,
  AUTOPOST_LATE_WINDOW_MINUTES,
  AUTOPOST_LEASE_SECONDS,
  AUTOPOST_MAX_PER_TICK,
  AUTOPOST_PERMALINK_RETRY_MINUTES,
  addDays,
  findDueSlot,
  jstDateOf,
  plannedSlotTime,
  projectSchedule,
  type DueSlot,
} from "@threads-grower/shared";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  min,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { createDb, type Db } from "../db/client";
import { accounts, postDrafts, postingSchedules, publishAttempts } from "../db/schema";
import type { Env } from "../env";
import { logger } from "../lib/logger";
import { createThreadsClient, type ThreadsClient } from "../lib/threads-client";
import { computeNextCheckAt, readGate, shouldRun, writeCatchupDate, writeGate } from "./auto-post-gate";
import { nextCatchupAt, runMetricsStage } from "./metrics-runner";
import { claimSlot } from "./publish-claim";
import { executeAttempt, fillPermalink, type ExecuteOutcome } from "./publish-executor";
import { loadThreadsCredentials } from "./threads-credentials";

/** 1回の定期処理の結果（ログとテストに使う）。 */
export type RunSummary = {
  /** DBの処理をしたか（関所で終えたら false） */
  ran: boolean;
  published: number;
  retried: number;
  carriedOver: number;
  failed: number;
  skipped: number;
  /** 公開の直前のチェックで要確認に戻した件数 */
  blocked: number;
  /** 1回4件の上限で、次の回に回した試み・時刻の数 */
  deferred: number;
  /** 60分を過ぎて飛ばした時刻の数 */
  expired: number;
  /** 結果を確かめる途中・コンテナーの処理中で、次の回に続ける試みの数 */
  waiting: number;
  /** 反応数の段階で次の回に続けたいものがあるか（specs/006） */
  metricsRemaining: boolean;
};

const empty = (): RunSummary => ({
  ran: false,
  published: 0,
  retried: 0,
  carriedOver: 0,
  failed: 0,
  skipped: 0,
  blocked: 0,
  deferred: 0,
  expired: 0,
  waiting: 0,
  metricsRemaining: false,
});

/**
 * 続きの処理の対象：持ち時間の切れた処理中、時刻の来たやり直し待ち。
 * @param now - 基準の時刻
 * @returns 取り出しの条件
 */
const continuable = (now: Date) =>
  or(
    and(
      eq(publishAttempts.state, "in_progress"),
      or(isNull(publishAttempts.leaseUntil), lt(publishAttempts.leaseUntil, now)),
    ),
    and(eq(publishAttempts.state, "retry_wait"), lte(publishAttempts.nextRetryAt, now)),
  );

/**
 * 自動投稿の定期処理を1回行う（contracts/auto-post-job.md）。1件・1つのAccountの失敗で全体を止めない。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻（回の実際の開始時刻。Cron の予定時刻ではない）
 * @param threads - Threads API のクライアント（テストで差し替えられる）
 * @param clock - 実際の時刻（投稿日時の記録に使う。テストで差し替えられる）
 * @returns この回の結果
 */
export async function runAutoPost(
  env: Env,
  now: Date = new Date(),
  threads: ThreadsClient = createThreadsClient(env),
  clock: () => Date = () => new Date(),
): Promise<RunSummary> {
  const summary = empty();
  // 0. 関所：用がなければDBに触れずに終える（research.md R3）
  const gateState = await readGate(env.AUTOPOST_KV);
  if (!shouldRun(gateState, now)) {
    logger.debug("auto-post: gate closed");
    return summary;
  }
  summary.ran = true;
  const db = createDb(env.DATABASE_URL);
  let budget = AUTOPOST_MAX_PER_TICK;
  // この回に公開した下書き（URLの取り直しはこの回では行わず、取れなかったものは次の回に取り直す）
  const publishedNow: string[] = [];
  let permalinkSoon = false;

  const tally = (o: ExecuteOutcome) => {
    if (o.kind === "published") {
      summary.published += 1;
      publishedNow.push(o.draftId);
      if (o.needsPermalink) permalinkSoon = true;
      const lag = (now.getTime() - o.slotAt.getTime()) / 60_000;
      logger.info("auto-post: published", { lagMinutes: Math.round(lag) });
      if (lag > AUTOPOST_LATE_WARN_MINUTES)
        logger.warn("auto-post: late publish", { lagMinutes: Math.round(lag) });
    } else if (o.kind === "retry") summary.retried += 1;
    else if (o.kind === "carried_over") summary.carriedOver += 1;
    else if (o.kind === "failed") summary.failed += 1;
    else if (o.kind === "skipped") summary.skipped += 1;
    else summary.waiting += 1;
  };
  const execute = async (attemptId: string, leaseToken: string) => {
    try {
      tally(await executeAttempt(env, db, threads, attemptId, leaseToken, now, clock));
    } catch (err) {
      // 持ち時間が切れた後、次の回の「続きの処理」で拾われる
      logger.error("auto-post: unexpected error in attempt", { attemptId, err });
      summary.waiting += 1;
    }
  };

  // 1. 続きの処理（結果を確かめる途中・やり直し待ち）
  // 前に確かめたのが古い順（やり直し待ち・持ち時間のないものが先）。同じ試みばかりを選ばない
  const pending = await db
    .select()
    .from(publishAttempts)
    .where(continuable(now))
    .orderBy(sql`${publishAttempts.leaseUntil} ASC NULLS FIRST`, asc(publishAttempts.slotAt));
  for (const a of pending) {
    if (budget <= 0) {
      summary.deferred += 1;
      continue;
    }
    // 新しい札で取る。前に持っていた処理（持ち時間が切れた古い処理）は、以後の更新ができなくなる
    const leaseToken = crypto.randomUUID();
    const [got] = await db
      .update(publishAttempts)
      .set({
        state: "in_progress",
        leaseUntil: new Date(now.getTime() + AUTOPOST_LEASE_SECONDS * 1000),
        leaseToken,
        updatedAt: now,
      })
      .where(and(eq(publishAttempts.id, a.id), continuable(now)))
      .returning({ id: publishAttempts.id });
    if (!got) continue; // ほかの処理が進めている
    budget -= 1;
    await execute(a.id, leaseToken);
  }

  // 2. 時刻の処理（来ている時刻の試みを作り、公開する）
  const schedules = await db
    .select({ schedule: postingSchedules })
    .from(postingSchedules)
    .innerJoin(accounts, eq(accounts.id, postingSchedules.accountId))
    .where(eq(postingSchedules.enabled, true));
  const accountIds = schedules.map((s) => s.schedule.accountId);
  const recent = accountIds.length
    ? await db
        .select({ accountId: publishAttempts.accountId, slotAt: publishAttempts.slotAt })
        .from(publishAttempts)
        .where(
          and(
            inArray(publishAttempts.accountId, accountIds),
            gte(publishAttempts.slotDate, addDays(jstDateOf(now), -2)),
          ),
        )
    : [];
  const used = new Map<string, Date[]>();
  for (const r of recent) used.set(r.accountId, [...(used.get(r.accountId) ?? []), r.slotAt]);
  const isUsed = (accountId: string, at: Date) =>
    (used.get(accountId) ?? []).some((d) => d.getTime() === at.getTime());

  const prevRun = gateState.gate
    ? Date.parse(gateState.gate.runStartedAt)
    : now.getTime() - 65 * 60_000;
  const windowMs = AUTOPOST_LATE_WINDOW_MINUTES * 60_000;
  const due: { accountId: string; slot: DueSlot }[] = [];
  for (const { schedule: s } of schedules) {
    const settings = {
      accountId: s.accountId,
      slotMinutes: s.slotMinutes,
      jitter: s.jitter,
      effectiveFrom: s.effectiveFrom,
    };
    const slot = findDueSlot({ ...settings, now });
    if (slot && !isUsed(s.accountId, slot.slotAt)) due.push({ accountId: s.accountId, slot });
    // 60分を過ぎて飛ばした時刻・まとめないで飛ばした古い時刻を数える（ログだけ。FR-011）
    const today = jstDateOf(now);
    for (const date of [addDays(today, -1), today]) {
      for (const minute of s.slotMinutes) {
        const at = plannedSlotTime(s.accountId, date, minute, s.jitter);
        const t = at.getTime();
        if (
          t <= s.effectiveFrom.getTime() ||
          isUsed(s.accountId, at) ||
          (slot && t === slot.slotAt.getTime())
        )
          continue;
        const justExpired = t > prevRun - windowMs && t <= now.getTime() - windowMs;
        const skippedOlder =
          slot !== null &&
          t > now.getTime() - windowMs &&
          t < slot.slotAt.getTime() &&
          t > prevRun - windowMs;
        if (justExpired || skippedOlder) summary.expired += 1;
      }
    }
  }
  due.sort((a, b) => a.slot.slotAt.getTime() - b.slot.slotAt.getTime());
  for (const d of due) {
    if (budget <= 0) {
      summary.deferred += 1;
      continue;
    }
    try {
      const r = await claimSlot(env, d.accountId, d.slot, now);
      // この回で行を作った（またはすでにあった）時刻は、次に見る時刻の計算で「使った」に入れる。
      // stale（設定が変わり、今の設定の時刻ではなくなった）も、この回では扱わない。
      // waiting（前の試みが終わるのを待つ）は、来ている時刻のまま残す
      if (r.kind !== "waiting")
        used.set(d.accountId, [...(used.get(d.accountId) ?? []), d.slot.slotAt]);
      if (r.kind === "skipped") {
        summary.skipped += 1;
        summary.blocked += r.blocked;
      } else if (r.kind === "claimed") {
        summary.blocked += r.blocked;
        budget -= 1;
        await execute(r.attemptId, r.leaseToken);
      }
    } catch (err) {
      summary.deferred += 1;
      logger.error("auto-post: failed to claim slot", { accountId: d.accountId, err });
    }
  }

  // 5. 投稿のURLの取り直し（余裕があるときだけ。SC-006）
  let permalinkPending = permalinkSoon;
  if (budget > 0 && (await refillPermalinks(env, db, threads, now, publishedNow)))
    permalinkPending = true;

  // 6. 反応数の段階（specs/006 contracts/metrics-job.md）。失敗しても公開の結果に影響させない
  let catchupDate = gateState.catchupDate;
  try {
    const metrics = await runMetricsStage(env, db, threads, {
      now,
      publishedThisTick: AUTOPOST_MAX_PER_TICK - budget,
      catchupDate,
    });
    summary.metricsRemaining = metrics.remaining;
    if (metrics.catchupFinished) {
      catchupDate = jstDateOf(now);
      if (!(await writeCatchupDate(env.AUTOPOST_KV, catchupDate))) logger.warn("metrics: failed to write catch-up date");
    }
  } catch (err) {
    logger.error("metrics: stage failed", { err });
  }

  // 7. 関所の書き込み
  const [[nextRetry], [inProgress]] = await Promise.all([
    db
      .select({ at: min(publishAttempts.nextRetryAt) })
      .from(publishAttempts)
      .where(eq(publishAttempts.state, "retry_wait")),
    // 処理中の試みは、次に確かめる時刻（lease_until）に起こす。持ち時間のないものがあれば次の回
    db
      .select({
        at: min(publishAttempts.leaseUntil),
        unleased: sql<number>`count(*) filter (where ${publishAttempts.leaseUntil} is null)`.mapWith(
          Number,
        ),
      })
      .from(publishAttempts)
      .where(eq(publishAttempts.state, "in_progress")),
  ]);
  // 反応数の補い（日本時間3:00）も候補にする（specs/006 research.md R2）
  const candidates: Date[] = [nextCatchupAt(now, catchupDate)];
  if (nextRetry?.at) candidates.push(nextRetry.at);
  if (inProgress?.at) candidates.push(inProgress.at);
  for (const { schedule: s } of schedules) {
    const [next] = projectSchedule({
      accountId: s.accountId,
      enabled: true,
      slotMinutes: s.slotMinutes,
      jitter: s.jitter,
      effectiveFrom: s.effectiveFrom,
      pausedUntil: s.pausedUntil,
      now,
      usedSlotTimes: used.get(s.accountId) ?? [],
      publishedToday: 0,
      count: 1,
    });
    if (next) candidates.push(next);
  }
  const nextCheckAt = computeNextCheckAt({
    now,
    candidates,
    immediate:
      summary.deferred > 0 || (inProgress?.unleased ?? 0) > 0 || permalinkPending || summary.metricsRemaining,
  });
  if (
    !(await writeGate(env.AUTOPOST_KV, {
      nextCheckAt: nextCheckAt.toISOString(),
      runStartedAt: now.toISOString(),
    }))
  ) {
    logger.warn("auto-post: failed to write gate");
  }

  logger.info("auto-post: run", { ...summary, nextCheckAt: nextCheckAt.toISOString() });
  if (summary.expired > 0) logger.warn("auto-post: slots expired", { expired: summary.expired });
  return summary;
}

/**
 * URLの空いた投稿済み（7日以内）を、最大2件取り直す（contracts/auto-post-job.md 手順5）。
 * 接続済みのAccountの投稿だけを、試していない・前に試したのが古い順に選ぶ。失敗したら permalink_checked_at を入れ、
 * AUTOPOST_PERMALINK_RETRY_MINUTES の間は選ばない（失敗し続ける投稿が、後の投稿の取り直しを止めない）。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param now - 今の時刻
 * @param exclude - この回に公開した下書き（公開の直後に一度試しているので、この回では選ばない）
 * @returns すぐに取り直せる投稿が残っているか（次の回にも取り直す）
 */
async function refillPermalinks(
  env: Env,
  db: Db,
  threads: ThreadsClient,
  now: Date,
  exclude: string[],
): Promise<boolean> {
  const retryBefore = new Date(now.getTime() - AUTOPOST_PERMALINK_RETRY_MINUTES * 60_000);
  const rows = await db
    .select({
      id: postDrafts.id,
      accountId: postDrafts.accountId,
      mediaId: postDrafts.threadsMediaId,
    })
    .from(postDrafts)
    .innerJoin(accounts, eq(accounts.id, postDrafts.accountId))
    .where(
      and(
        eq(postDrafts.status, "published"),
        isNull(postDrafts.threadsPermalink),
        sql`${postDrafts.threadsMediaId} IS NOT NULL`,
        gte(postDrafts.publishedAt, new Date(now.getTime() - 7 * 86_400_000)),
        eq(accounts.connectionStatus, "connected"),
        or(isNull(postDrafts.permalinkCheckedAt), lt(postDrafts.permalinkCheckedAt, retryBefore)),
        exclude.length ? notInArray(postDrafts.id, exclude) : undefined,
      ),
    )
    .orderBy(sql`${postDrafts.permalinkCheckedAt} ASC NULLS FIRST`, desc(postDrafts.publishedAt))
    .limit(3);
  for (const r of rows.slice(0, 2)) {
    const cred = await loadThreadsCredentials(env, db, r.accountId);
    const ok = cred?.token ? await fillPermalink(db, threads, cred.token, r.id, r.mediaId!) : false;
    if (!ok)
      await db
        .update(postDrafts)
        .set({ permalinkCheckedAt: now })
        .where(eq(postDrafts.id, r.id));
  }
  // 3件目があれば、次の回にすぐ続ける。失敗した投稿は、間をあけてから（ほかの用で起きた回に）取り直す
  return rows.length > 2;
}

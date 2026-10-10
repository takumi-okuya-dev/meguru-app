// 投稿の設定（specs/005-auto-post research.md R1、contracts/api.md「GET・PUT /posting-schedule」）。
// 自動投稿は全プランで使えるので、grower機能は判定しない（FR-004）。
import type { AccountAccess } from "./access";
import { recordActivity, updatedByOf, withActivityTx } from "./activity-log";
import {
  minutesToTime,
  validatePostingSchedule,
  type AutoPostState,
  type PostingSchedule,
  type PutPostingScheduleRequest,
  type ThreadsCheck,
} from "@threads-grower/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { postingSchedules } from "../db/schema";
import type { Env } from "../env";
import { AppError, notFound, pgErrorCode } from "../lib/errors";
import { logger } from "../lib/logger";
import type { ThreadsClient } from "../lib/threads-client";
import type { AccountRow } from "./access";
import { checkThreadsPublish } from "./threads-check-service";

/** posting_schedules の行。 */
export type PostingScheduleRow = typeof postingSchedules.$inferSelect;

/**
 * そのAccountの投稿の設定の行を読む。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 行。最初の保存の前は null
 */
export async function readPostingSchedule(
  db: Db | TxDb,
  accountId: string,
): Promise<PostingScheduleRow | null> {
  const [row] = await db
    .select()
    .from(postingSchedules)
    .where(eq(postingSchedules.accountId, accountId))
    .limit(1);
  return row ?? null;
}

/**
 * 行を、レスポンスの PostingSchedule にする。行がなければ既定値（オフ・時刻なし・ずらす・version 0）。
 * @param row - posting_schedules の行
 * @returns PostingSchedule
 */
export function toPostingSchedule(row: PostingScheduleRow | null): PostingSchedule {
  if (!row) return { enabled: false, slotTimes: [], jitter: true, version: 0 };
  return {
    enabled: row.enabled,
    slotTimes: row.slotMinutes.map(minutesToTime),
    jitter: row.jitter,
    version: row.version,
  };
}

/**
 * 自動投稿の状態（オン・オフ、時刻の数、止まっている理由）。
 * @param account - Account の行（接続の状態）
 * @param row - posting_schedules の行
 * @param now - 今の時刻
 * @returns AutoPostState
 */
export function toAutoPostState(
  account: Pick<AccountRow, "connectionStatus">,
  row: PostingScheduleRow | null,
  now: Date,
): AutoPostState {
  const enabled = row?.enabled ?? false;
  let stoppedReason: AutoPostState["stoppedReason"] = null;
  if (enabled && account.connectionStatus === "needs_reconnect") stoppedReason = "needs_reconnect";
  else if (enabled && row?.pausedUntil && row.pausedUntil.getTime() > now.getTime())
    stoppedReason = "rate_limited";
  return { enabled, slotCount: row?.slotMinutes.length ?? 0, stoppedReason };
}

/**
 * 時刻の一覧が同じかを確かめる。
 * @param a - 保存済みの時刻
 * @param b - 新しい時刻
 * @returns 一覧が一致するか
 */
function sameMinutes(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

/**
 * 投稿の設定を保存する（FR-001〜FR-003・FR-002a・FR-012）。
 * - 入力は validatePostingSchedule で確かめる（WebとAPIで同じもの）
 * - 自動投稿をオンにする保存では、保存の前に投稿の権限を確かめる（テストの投稿はしない。research.md R15）
 * - version で競合を検知する（002 R3）。最初の保存は expectedVersion: 0
 * - effective_from は、オフ→オン・時刻の変更・ずらすかの切り替えのときだけ今にする（research.md R1）
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param accountId - accounts.id
 * @param req - リクエスト（スキーマで形を確かめてあること）
 * @param threads - Threads API のクライアント
 * @param now - 今の時刻
 * @param access - 操作した人（操作の記録と、保存した人に使う。specs/008）。省略すると記録しない
 * @returns 保存した設定と、投稿の権限の確認の結果（オフの保存では null）
 * @throws AppError VALIDATION_FAILED（details と reason）、THREADS_NOT_READY（details に結果）、STALE_UPDATE（latest 付き）、ACCOUNT_NOT_FOUND
 */
export async function savePostingSchedule(
  env: Env,
  db: Db,
  accountId: string,
  req: PutPostingScheduleRequest,
  threads: ThreadsClient,
  now: Date = new Date(),
  access?: AccountAccess,
): Promise<{ schedule: PostingSchedule; connectionCheck: ThreadsCheck | null }> {
  const v = validatePostingSchedule(req);
  if (!v.ok) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "invalid posting schedule",
      undefined,
      [v.reason === "required" ? "enabled" : "slotTimes"],
      {
        reason: v.reason,
      },
    );
  }
  const current = await readPostingSchedule(db, accountId);
  if ((current?.version ?? 0) !== req.expectedVersion) {
    // 先に保存した人の名前を添える（specs/008 FR-007）
    throw new AppError(
      "STALE_UPDATE",
      409,
      "updated elsewhere",
      toPostingSchedule(current),
      undefined,
      {
        updatedBy: await updatedByOf(db, current?.updatedByUserId),
      },
    );
  }

  let connectionCheck: ThreadsCheck | null = null;
  if (req.enabled) {
    connectionCheck = await checkThreadsPublish(env, db, accountId, threads);
    if (
      connectionCheck.status === "needs_reconnect" ||
      connectionCheck.status === "no_publish_permission"
    ) {
      throw new AppError("THREADS_NOT_READY", 409, "threads not ready", undefined, [
        connectionCheck.status,
      ]);
    }
  }

  const timingChanged =
    !current ||
    (!current.enabled && req.enabled) ||
    !sameMinutes(current.slotMinutes, v.slotMinutes) ||
    current.jitter !== req.jitter;
  const values = {
    enabled: req.enabled,
    slotMinutes: v.slotMinutes,
    jitter: req.jitter,
    ...(timingChanged ? { effectiveFrom: now } : {}),
    ...(access ? { updatedByUserId: access.actor.id } : {}),
    updatedAt: now,
  };
  try {
    // 保存と操作の記録を同じトランザクションにする（接続の確認は外部の呼び出しなので、その前に済ませる。PR #9 のCodexレビュー）
    return await withActivityTx(env.DATABASE_URL, db, access, async (q) => {
      const [row] = current
        ? await q
            .update(postingSchedules)
            .set({ ...values, version: sql`${postingSchedules.version} + 1` })
            .where(
              and(
                eq(postingSchedules.accountId, accountId),
                eq(postingSchedules.version, req.expectedVersion),
              ),
            )
            .returning()
        : await q
            .insert(postingSchedules)
            .values({ accountId, ...values, effectiveFrom: now })
            .onConflictDoNothing()
            .returning();
      if (!row) {
        const latest = await readPostingSchedule(q, accountId);
        throw new AppError(
          "STALE_UPDATE",
          409,
          "updated elsewhere",
          toPostingSchedule(latest),
          undefined,
          {
            updatedBy: await updatedByOf(q, latest?.updatedByUserId),
          },
        );
      }
      if (access) {
        await recordActivity(q, access, {
          kind: "settings",
          action: "schedule_saved",
          summary: `自動投稿${row.enabled ? "オン" : "オフ"}・1日${row.slotMinutes.length}件`,
        });
      }
      return { schedule: toPostingSchedule(row), connectionCheck };
    });
  } catch (err) {
    // 外部キー違反：途中でAccountが削除された
    if (pgErrorCode(err) === "23503") throw notFound();
    throw err;
  }
}

const WAKE_RETRY_DELAYS_MS = [500, 1000, 2000];

/**
 * 定期処理に、設定が変わったことを知らせる（KV の autopost:wake。research.md R3）。
 * 書き込みに失敗したら、間をあけて最大3回まで書き直す（同じキーへの書き込みは1秒に1回までのため）。
 * それでも失敗したらログに出すだけにする（だれかの予定の時刻か、24時間以内の見直しで拾われる）。
 * @param kv - AUTOPOST_KV
 * @param at - 知らせる時刻（保存した時刻）
 */
export async function notifyWake(kv: KVNamespace, at: Date): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await kv.put("autopost:wake", JSON.stringify({ at: at.toISOString() }));
      return;
    } catch (err) {
      if (attempt >= WAKE_RETRY_DELAYS_MS.length) {
        logger.error("failed to notify auto-post wake", { err });
        return;
      }
      await new Promise((r) => setTimeout(r, WAKE_RETRY_DELAYS_MS[attempt]));
    }
  }
}

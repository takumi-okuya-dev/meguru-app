// 日次の定期処理（contracts/api.md「定期処理」1〜6）。1件・1つの処理の失敗で全体を止めない
import type { Env } from "../kernel/env";
import { createDb } from "../kernel/db/client";
import { logger } from "../kernel/logger";
import { createThreadsClient } from "../adapters/threads-api";
import {
  cleanupDeletionIdentifiers,
  retryDeletions,
  cleanupRevocations,
  refreshExpiringTokens,
  purgeTokenCheckFailures,
  registerThreads,
  cleanupExpiredOauthStates,
  cleanupPublishAttempts,
  clearExpiredPauses,
  purgeOldActivity,
  recountThreadsUsage,
} from "../apps/threads";
import { purgeDeliveredEvents, reconcileSubscriptions, clerkUserDeleter, resumeWithdrawals } from "../platform";

/**
 * 日次の定期処理をまとめて行う（contracts/api.md「定期処理」）。1つの処理の失敗で全体を止めない。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻（回の実際の開始時刻）
 */
export async function runDailyJobs(env: Env, now: Date = new Date()) {
  // 退会のやり直しなどで共通の処理が知らせを出すので、受け取りを登録しておく（specs/027。何度呼んでも1回だけ）
  registerThreads();
  const steps: [string, () => Promise<unknown>][] = [
    ["token refresh", () => refreshExpiringTokens(env, createThreadsClient(env), now)],
    ["expired oauth states", () => cleanupExpiredOauthStates(env, now)],
    ["revocations cleanup", () => cleanupRevocations(env, now)],
    // 操作の記録は90日で消す（specs/008 FR-051、research.md R9）
    ["activity logs cleanup", () => purgeOldActivity(createDb(env.DATABASE_URL), now)],
    // トークンの確認の失敗は1日で消す（specs/010 data-model.md）
    ["token check failures cleanup", () => purgeTokenCheckFailures(env, now)],
    ["data deletion retry", () => retryDeletions(env, now)],
    // Threadsの利用の数を数え直して共通へ伝える（伝え損ねた分を直す。specs/meguru/029 research.md R6）。料金の合わせ直しの前に行う
    ["threads usage recount", () => recountThreadsUsage(env)],
    // 契約の状態とアカウントの数を、Stripeと合わせ直す（specs/013 research.md R5・R6）。データ削除の後に行う
    ["billing reconcile", () => reconcileSubscriptions(env)],
    // 退会の続き（契約を止める・データを消す・ログインの情報を消す。specs/013 research.md R10）
    ["withdrawal resume", () => resumeWithdrawals(env, clerkUserDeleter(env), now)],
    ["deletion identifiers cleanup", () => cleanupDeletionIdentifiers(env, now)],
    ["publish attempts cleanup", () => cleanupPublishAttempts(env, now)],
    // 過ぎた停止を消す（contracts/api.md「定期処理」。設定の版は変えない。data-model.md）
    ["expired publish pauses", () => clearExpiredPauses(env, now)],
    // 届け先がすべて済んで30日たった出来事を消す（specs/meguru/029 research.md R5）
    ["delivered events cleanup", () => purgeDeliveredEvents(createDb(env.DATABASE_URL), now)],
  ];
  for (const [name, run] of steps) {
    try {
      const result = await run();
      logger.info(`daily job: ${name}`, { result });
    } catch (err) {
      logger.error(`daily job failed: ${name}`, { err });
    }
  }
}

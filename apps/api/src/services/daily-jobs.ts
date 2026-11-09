// 日次の定期処理（contracts/api.md「定期処理」1〜6）。1件・1つの処理の失敗で全体を止めない
import { AUTOPOST_ATTEMPT_RETENTION_DAYS, addDays, jstDateOf } from "@threads-grower/shared";
import type { Env } from "../kernel/env";
import { createDb } from "../kernel/db/client";
import { oauthStates, postDrafts, postingSchedules, publishAttempts } from "../db/schema";
import { and, eq, isNotNull, lt, notExists, notInArray } from "drizzle-orm";
import { logger } from "../kernel/logger";
import { createThreadsClient } from "../adapters/threads-api";
import { cleanupDeletionIdentifiers, retryDeletions } from "./data-deletion";
import { cleanupRevocations } from "./revocation";
import { refreshExpiringTokens } from "./token-refresh";
import { purgeTokenCheckFailures } from "./token-connect";
import { purgeOldActivity } from "./activity-log";
import { reconcileSubscriptions } from "./billing-service";
import { clerkUserDeleter, resumeWithdrawals } from "./withdrawal-service";

/**
 * 日次の定期処理をまとめて行う（contracts/api.md「定期処理」）。1つの処理の失敗で全体を止めない。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻（回の実際の開始時刻）
 */
export async function runDailyJobs(env: Env, now: Date = new Date()) {
  const steps: [string, () => Promise<unknown>][] = [
    ["token refresh", () => refreshExpiringTokens(env, createThreadsClient(env), now)],
    [
      "expired oauth states",
      async () => ({
        deleted: (
          await createDb(env.DATABASE_URL)
            .delete(oauthStates)
            .where(lt(oauthStates.expiresAt, now))
            .returning()
        ).length,
      }),
    ],
    ["revocations cleanup", () => cleanupRevocations(env, now)],
    // 操作の記録は90日で消す（specs/008 FR-051、research.md R9）
    ["activity logs cleanup", () => purgeOldActivity(createDb(env.DATABASE_URL), now)],
    // トークンの確認の失敗は1日で消す（specs/010 data-model.md）
    ["token check failures cleanup", () => purgeTokenCheckFailures(env, now)],
    ["data deletion retry", () => retryDeletions(env, now)],
    // 契約の状態とアカウントの数を、Stripeと合わせ直す（specs/013 research.md R5・R6）。データ削除の後に行う
    ["billing reconcile", () => reconcileSubscriptions(env)],
    // 退会の続き（契約を止める・データを消す・ログインの情報を消す。specs/013 research.md R10）
    ["withdrawal resume", () => resumeWithdrawals(env, clerkUserDeleter(env), now)],
    ["deletion identifiers cleanup", () => cleanupDeletionIdentifiers(env, now)],
    [
      "publish attempts cleanup",
      async () => ({
        deleted: (
          await createDb(env.DATABASE_URL)
            .delete(publishAttempts)
            .where(
              and(
                lt(
                  publishAttempts.slotDate,
                  addDays(jstDateOf(now), -AUTOPOST_ATTEMPT_RETENTION_DAYS),
                ),
                // 処理中・やり直し待ちは、下書きを publishing のまま残すので消さない（結果を確かめ終えてから消す）
                notInArray(publishAttempts.state, ["in_progress", "retry_wait"]),
                // 持ち越し（carried_over）で下書きが参照している試みは、次の時刻の優先と「持ち越しは1回だけ」を決めるので消さない
                notExists(
                  createDb(env.DATABASE_URL)
                    .select({ id: postDrafts.id })
                    .from(postDrafts)
                    .where(eq(postDrafts.carryoverAttemptId, publishAttempts.id)),
                ),
              ),
            )
            .returning({ id: publishAttempts.id })
        ).length,
      }),
    ],
    [
      // 過ぎた停止を消す（contracts/api.md「定期処理」。設定の版は変えない。data-model.md）
      "expired publish pauses",
      async () => ({
        cleared: (
          await createDb(env.DATABASE_URL)
            .update(postingSchedules)
            .set({ pausedUntil: null })
            .where(and(isNotNull(postingSchedules.pausedUntil), lt(postingSchedules.pausedUntil, now)))
            .returning({ accountId: postingSchedules.accountId })
        ).length,
      }),
    ],
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

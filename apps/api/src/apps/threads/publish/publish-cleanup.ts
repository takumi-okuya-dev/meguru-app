// 自動投稿の毎日の片づけ（contracts/api.md「定期処理」）。027で jobs/daily-jobs.ts から移した（表の持ち主はThreads）。
import { AUTOPOST_ATTEMPT_RETENTION_DAYS, addDays, jstDateOf } from "@meguru/shared";
import { and, eq, isNotNull, lt, notExists, notInArray } from "drizzle-orm";
import type { Env } from "../../../kernel/env";
import { createDb } from "../../../kernel/db/client";
import { postDrafts, postingSchedules, publishAttempts } from "../schema";

/**
 * 古い投稿の試みを消す（保存の日数を過ぎたもの。処理中・やり直し待ち・持ち越しで参照中のものは残す）。
 * @param env - Workers のバインディング
 * @param now - 基準の時刻
 * @returns 消した数
 */
export async function cleanupPublishAttempts(env: Pick<Env, "DATABASE_URL">, now: Date) {
  return {
    deleted: (
      await createDb(env.DATABASE_URL)
        .delete(publishAttempts)
        .where(
          and(
            lt(publishAttempts.slotDate, addDays(jstDateOf(now), -AUTOPOST_ATTEMPT_RETENTION_DAYS)),
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
  };
}

/**
 * 過ぎた停止を消す（設定の版は変えない。data-model.md）。
 * @param env - Workers のバインディング
 * @param now - 基準の時刻
 * @returns 消した数
 */
export async function clearExpiredPauses(env: Pick<Env, "DATABASE_URL">, now: Date) {
  return {
    cleared: (
      await createDb(env.DATABASE_URL)
        .update(postingSchedules)
        .set({ pausedUntil: null })
        .where(and(isNotNull(postingSchedules.pausedUntil), lt(postingSchedules.pausedUntil, now)))
        .returning({ accountId: postingSchedules.accountId })
    ).length,
  };
}

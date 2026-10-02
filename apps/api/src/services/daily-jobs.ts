// 日次の定期処理（contracts/api.md「定期処理」1〜6）。1件・1つの処理の失敗で全体を止めない
import type { Env } from "../env";
import { createDb } from "../db/client";
import { oauthStates } from "../db/schema";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createThreadsClient } from "../lib/threads-client";
import { cleanupDeletionIdentifiers, retryDeletions } from "./data-deletion";
import { cleanupRevocations } from "./revocation";
import { refreshExpiringTokens } from "./token-refresh";

/**
 * 日次の定期処理をまとめて行う（contracts/api.md「定期処理」）。1つの処理の失敗で全体を止めない。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻（Cron Trigger の予定時刻）
 */
export async function runDailyJobs(env: Env, now: Date = new Date()) {
  const steps: [string, () => Promise<unknown>][] = [
    ["token refresh", () => refreshExpiringTokens(env, createThreadsClient(env), now)],
    [
      "expired oauth states",
      async () => ({
        deleted: (await createDb(env.DATABASE_URL).delete(oauthStates).where(lt(oauthStates.expiresAt, now)).returning())
          .length,
      }),
    ],
    ["revocations cleanup", () => cleanupRevocations(env, now)],
    ["data deletion retry", () => retryDeletions(env, now)],
    ["deletion identifiers cleanup", () => cleanupDeletionIdentifiers(env, now)],
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

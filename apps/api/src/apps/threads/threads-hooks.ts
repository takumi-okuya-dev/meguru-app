// Threadsが受け取る知らせ（specs/027-modular-monolith research.md R4、docs/module-map.md 1-4）。
// 共通（platform）の処理の途中でThreadsの処理が要るところを、知らせとして受け取る。組み立てが registerThreads() を呼ぶ。
import { and, inArray } from "drizzle-orm";
import { createThreadsClient } from "../../adapters/threads-api";
import { registerAppFeatures, registerAppLimits, registerHook, registerModule } from "../../platform";
import { THREADS_APP, THREADS_FEATURES, THREADS_LIMITS } from "./registry";
import { threadsDeletionRequests } from "./schema";
import { verifyConnection } from "./connection/connection-service";
import { notifyWake } from "./publish/posting-schedule-service";
import { purgeForWithdrawal, withdrawForAccountDeletion } from "./tester-invites/tester-application-service";

/** Threadsの受け取りを登録する。何度呼んでも1回だけ登録する（app.ts・index.ts・毎日の処理の初めで呼ぶ）。 */
export function registerThreads(): void {
  registerModule("threads", () => {
    // 機能のまとまりと上限の名前を、共通に登録する（specs/meguru/029 research.md R7）
    registerAppFeatures(THREADS_APP, THREADS_FEATURES);
    registerAppLimits(THREADS_APP, THREADS_LIMITS);
    // アカウントを消す前：生きているテスター招待の申し込みを取り下げる（specs/024 research.md R5）
    registerHook("accountDeleting", ({ tx, accountId }) => withdrawForAccountDeletion(tx, accountId));
    // 退会の初め：招待の申し込みを片づける（specs/024 research.md R15）
    registerHook("userWithdrawing", ({ tx, userId }) => purgeForWithdrawal(tx, userId));
    // 退会でアカウントを消したあと：Threads側からのデータ削除の求めが処理中なら完了にする
    registerHook("userAccountsDeleted", async ({ tx, threadsUserIds, now }) => {
      if (threadsUserIds.length === 0) return;
      await tx
        .update(threadsDeletionRequests)
        .set({ status: "completed", completedAt: now, threadsUserId: null })
        .where(
          and(
            inArray(threadsDeletionRequests.threadsUserId, threadsUserIds),
            inArray(threadsDeletionRequests.status, ["pending", "failed"]),
          ),
        );
    });
    // 上限が変わった：自動投稿の定期処理を起こす（specs/024）
    registerHook("limitsChanged", ({ env }) => notifyWake(env.AUTOPOST_KV, new Date()));
    // アカウントを開いた：保存しているトークンで接続を確かめる（specs/001 FR-018）
    registerHook("accountOpened", ({ env, accountId }) => verifyConnection(env, accountId, createThreadsClient(env)));
  });
}

// 投稿の権限の確認（specs/005-auto-post FR-002a・FR-002b、research.md R15）。
// threads_publishing_limit は投稿の権限（threads_content_publish）がないと呼べないので、投稿せずに確かめられる。
import type { ThreadsCheck } from "@threads-grower/shared";
import type { Db } from "../db/client";
import type { Env } from "../env";
import { logger } from "../lib/logger";
import {
  ThreadsApiError,
  ThreadsAuthError,
  ThreadsRateLimitError,
  ThreadsTransientError,
  type ThreadsClient,
} from "../lib/threads-client";
import { loadThreadsCredentials, markNeedsReconnect } from "./threads-credentials";

/**
 * そのAccountが、Threadsに投稿できる状態かを確かめる。テストの投稿はしない。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param accountId - accounts.id
 * @param threads - Threads API のクライアント
 * @returns ok（使用量つき）・needs_reconnect・no_publish_permission・unknown
 */
export async function checkThreadsPublish(
  env: Env,
  db: Db,
  accountId: string,
  threads: ThreadsClient,
): Promise<ThreadsCheck> {
  const cred = await loadThreadsCredentials(env, db, accountId);
  if (!cred || cred.connectionStatus === "needs_reconnect") return { status: "needs_reconnect" };
  // 鍵の設定ミスなどで復号できないときは、接続の状態を変えずに「確かめられなかった」にする（001 R5）
  if (!cred.token) return { status: "unknown" };
  try {
    const { quotaUsage, quotaTotal } = await threads.getPublishingLimit(
      cred.token,
      cred.threadsUserId,
    );
    return { status: "ok", quotaUsage, quotaTotal };
  } catch (err) {
    // 上限・一時的な失敗も ThreadsApiError の一種なので、先に見る
    if (err instanceof ThreadsRateLimitError || err instanceof ThreadsTransientError) {
      logger.warn("threads publish check could not be completed", { accountId, err });
      return { status: "unknown" };
    }
    if (err instanceof ThreadsAuthError) {
      await markNeedsReconnect(db, accountId, cred.generation);
      return { status: "needs_reconnect" };
    }
    if (err instanceof ThreadsApiError) return { status: "no_publish_permission" };
    throw err;
  }
}

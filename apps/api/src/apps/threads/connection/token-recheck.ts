// 期限を確かめられなかったトークンの、2時間後の確かめ直し（specs/010-token-account-add FR-012、research.md R8）。
// 5分ごとの定期処理の中で動き、関所の「次に見る時刻」に最も早い recheck_at を足す。新しいCronは足さない。
// 書き込みは読んだ時点の connection_generation を条件にし、その間に接続し直していれば結果を捨てる（001 R6）。
import { TOKEN_RECHECK_BATCH, TOKEN_RECHECK_RETRY_MINUTES } from "@meguru/shared";
import { and, asc, eq, isNotNull, lte, min, sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { threadsConnections } from "../schema";
import { accounts } from "../schema";
import type { Env } from "../../../kernel/env";
import { logger } from "../../../kernel/logger";
import { ThreadsApiError, ThreadsAuthError, type ThreadsClient } from "../../../adapters/threads-api";
import { loadThreadsCredentials } from "./threads-credentials";

const sameGeneration = (accountId: string, generation: number) =>
  sql`(SELECT ${accounts.connectionGeneration} FROM ${accounts} WHERE ${accounts.id} = ${accountId}) = ${generation}`;

/**
 * 1件の接続を確かめ直す。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param accountId - accounts.id
 * @param now - 今
 * @returns 結果（ok・needs_reconnect・retry）
 */
export async function recheckOne(
  env: Env,
  db: Db,
  threads: ThreadsClient,
  accountId: string,
  now: Date,
): Promise<"ok" | "needs_reconnect" | "retry"> {
  const cred = await loadThreadsCredentials(env, db, accountId);
  if (!cred) return "ok";
  const where = and(eq(threadsConnections.accountId, accountId), sameGeneration(accountId, cred.generation));
  const retry = async () => {
    await db
      .update(threadsConnections)
      .set({ recheckAt: new Date(now.getTime() + TOKEN_RECHECK_RETRY_MINUTES * 60_000), updatedAt: now })
      .where(where);
    return "retry" as const;
  };
  // 鍵の設定ミスなどで復号できないときは、接続の状態を変えずにやり直す（001 R5）
  if (!cred.token) return retry();
  try {
    await threads.getProfile(cred.token);
  } catch (err) {
    if (err instanceof ThreadsAuthError) {
      // 使えない：短期トークンだった可能性を添えて要再接続にする
      await db
        .update(accounts)
        .set({ connectionStatus: "needs_reconnect", reconnectHint: "short_lived_token", updatedAt: now })
        .where(and(eq(accounts.id, accountId), eq(accounts.connectionGeneration, cred.generation)));
      await db.update(threadsConnections).set({ recheckAt: null, updatedAt: now }).where(where);
      return "needs_reconnect";
    }
    if (err instanceof ThreadsApiError) return retry();
    throw err;
  }
  // 使えた：期限を読めれば直す（読めなければ60日とみなしたまま）
  const info = await threads.debugToken(cred.token).catch(() => null);
  const expiresAt = info?.expiresAt ?? null;
  // 権限の一覧が読めたら、返信の権限の印を合わせる（specs/023 research.md R1）
  if (info && info.scopes.length > 0)
    await db
      .update(accounts)
      .set({ repliesDeniedAt: info.scopes.includes("threads_manage_replies") ? null : now })
      .where(eq(accounts.id, accountId));
  await db
    .update(threadsConnections)
    .set({ recheckAt: null, ...(expiresAt ? { expiresAt } : {}), updatedAt: now })
    .where(where);
  return "ok";
}

/**
 * 時刻を過ぎた確かめ直しを、1回に最大20件行う。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param now - 今
 * @returns 確かめた件数と、次の回に続きがあるか
 */
export async function runTokenRecheck(env: Env, db: Db, threads: ThreadsClient, now: Date) {
  const due = await db
    .select({ accountId: threadsConnections.accountId })
    .from(threadsConnections)
    .where(and(isNotNull(threadsConnections.recheckAt), lte(threadsConnections.recheckAt, now)))
    .orderBy(asc(threadsConnections.recheckAt))
    .limit(TOKEN_RECHECK_BATCH + 1);
  let checked = 0;
  for (const { accountId } of due.slice(0, TOKEN_RECHECK_BATCH)) {
    try {
      const result = await recheckOne(env, db, threads, accountId, now);
      logger.info("token recheck", { accountId, result });
      checked += 1;
    } catch (err) {
      logger.error("token recheck failed", { accountId, err });
    }
  }
  return { checked, remaining: due.length > TOKEN_RECHECK_BATCH };
}

/**
 * 次の確かめ直しの時刻（関所の候補。なければ null）。
 * @param db - データベース
 * @returns 最も早い recheck_at
 */
export async function nextRecheckAt(db: Db): Promise<Date | null> {
  const [row] = await db.select({ at: min(threadsConnections.recheckAt) }).from(threadsConnections);
  return row?.at ?? null;
}

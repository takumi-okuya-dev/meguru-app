// 日次のトークン更新（FR-021、research.md R6）。
// 期限まで7日を切り、発行から24時間以上経った接続を更新し、プロフィールも取り直す。
// 書き込みはすべて読んだ時点の accounts.connection_generation を条件にし、その間に再接続・アンインストールで
// 接続が変わっていれば結果を捨てる（行を作り直しても番号は戻らないので ABA も起きない）。
import { and, eq, gt, lt } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction } from "../db/client";
import { accounts, threadsConnections } from "../db/schema";
import { createTokenCipher } from "../lib/crypto";
import { logger } from "../lib/logger";
import { ThreadsAuthError, type ThreadsClient } from "../lib/threads-client";
import { lockUsernameForUpdate } from "./username-match";

const DAY_MS = 24 * 3600_000;

/** 定期更新の対象の接続。読んだ時点の世代番号を持つ。 */
export type RefreshCandidate = {
  accountId: string;
  generation: number;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
};

/**
 * 定期更新の対象を選ぶ。期限まで7日を切り、発行から24時間以上経った、まだ有効な接続。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻
 * @returns 定期更新の対象
 */
export async function selectRefreshCandidates(env: Env, now: Date): Promise<RefreshCandidate[]> {
  const db = createDb(env.DATABASE_URL);
  const rows = await db
    .select({
      accountId: accounts.id,
      generation: accounts.connectionGeneration,
      ciphertext: threadsConnections.accessTokenCiphertext,
      iv: threadsConnections.accessTokenIv,
      keyVersion: threadsConnections.keyVersion,
    })
    .from(threadsConnections)
    .innerJoin(accounts, eq(accounts.id, threadsConnections.accountId))
    .where(
      and(
        lt(threadsConnections.expiresAt, new Date(now.getTime() + 7 * DAY_MS)),
        gt(threadsConnections.expiresAt, now),
        lt(threadsConnections.issuedAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  return rows;
}

async function markNeedsReconnect(env: Env, accountId: string, generation: number) {
  await createDb(env.DATABASE_URL)
    .update(accounts)
    .set({ connectionStatus: "needs_reconnect", updatedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.connectionGeneration, generation)));
}

/**
 * 接続を1件更新する（research.md R6）。プロフィールも取り直し、IVは新しく作る。
 * 書き込みは、読んだ時点の connection_generation を条件にし、その間に変わっていれば結果を捨てる。
 * @param env - Workers のバインディング
 * @param threads - Threads API のクライアント
 * @param c - 定期更新の対象
 * @returns refreshed（更新した）・needs_reconnect（認証エラー）・stale（その間に接続が変わった）・failed（その他の失敗）
 */
export async function refreshOne(
  env: Env,
  threads: ThreadsClient,
  c: RefreshCandidate,
): Promise<"refreshed" | "needs_reconnect" | "stale" | "failed"> {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  let token: string;
  try {
    token = await cipher.decrypt({ ciphertext: c.ciphertext, iv: c.iv, keyVersion: c.keyVersion }, c.accountId);
  } catch (err) {
    // 鍵の設定ミスなどで復号できないときは、接続状態を変えない（research.md R5）
    logger.error("failed to decrypt threads token for refresh", { accountId: c.accountId, err });
    return "failed";
  }

  let refreshed: { accessToken: string; expiresAt: Date };
  let profile: Awaited<ReturnType<ThreadsClient["getProfile"]>>;
  try {
    refreshed = await threads.refresh(token);
    profile = await threads.getProfile(refreshed.accessToken);
  } catch (err) {
    if (err instanceof ThreadsAuthError) {
      await markNeedsReconnect(env, c.accountId, c.generation);
      return "needs_reconnect";
    }
    logger.warn("threads token refresh failed", { accountId: c.accountId, err });
    return "failed";
  }

  // IVは暗号化のたびに新しく作る
  const enc = await cipher.encrypt(refreshed.accessToken, c.accountId);
  const now = new Date();
  return withTransaction(env.DATABASE_URL, async (tx) => {
    // プロフィールの名前を書き換えるので、接続の確定と同じユーザー名のロックに並ぶ（specs/010、PR #12 のCodexレビュー）
    await lockUsernameForUpdate(tx, c.accountId, profile.username);
    const bumped = await tx
      .update(accounts)
      .set({
        connectionGeneration: c.generation + 1,
        username: profile.username,
        displayName: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
        connectionStatus: "connected",
        updatedAt: now,
      })
      .where(and(eq(accounts.id, c.accountId), eq(accounts.connectionGeneration, c.generation)))
      .returning({ id: accounts.id });
    if (bumped.length === 0) return "stale" as const;
    await tx
      .update(threadsConnections)
      .set({
        accessTokenCiphertext: enc.ciphertext,
        accessTokenIv: enc.iv,
        keyVersion: enc.keyVersion,
        expiresAt: refreshed.expiresAt,
        issuedAt: now,
        updatedAt: now,
      })
      .where(eq(threadsConnections.accountId, c.accountId));
    return "refreshed" as const;
  });
}

/**
 * 日次のトークン更新（FR-021）。期限を過ぎた接続は needs_reconnect にし、対象の接続を更新する。1件の失敗で全体を止めない。
 * @param env - Workers のバインディング
 * @param threads - Threads API のクライアント
 * @param now - 基準にする時刻
 * @returns 結果ごとの件数
 */
export async function refreshExpiringTokens(env: Env, threads: ThreadsClient, now: Date) {
  const result = { refreshed: 0, needsReconnect: 0, stale: 0, failed: 0, expired: 0 };

  // 期限を過ぎた接続は needs_reconnect（読んだ世代番号を条件に）
  const db = createDb(env.DATABASE_URL);
  const expired = await db
    .select({ accountId: accounts.id, generation: accounts.connectionGeneration })
    .from(threadsConnections)
    .innerJoin(accounts, eq(accounts.id, threadsConnections.accountId))
    .where(and(lt(threadsConnections.expiresAt, now), eq(accounts.connectionStatus, "connected")));
  for (const e of expired) {
    await markNeedsReconnect(env, e.accountId, e.generation);
    result.expired += 1;
  }

  // 1件の失敗で全体を止めない
  for (const c of await selectRefreshCandidates(env, now)) {
    try {
      const outcome = await refreshOne(env, threads, c);
      if (outcome === "refreshed") result.refreshed += 1;
      else if (outcome === "needs_reconnect") result.needsReconnect += 1;
      else if (outcome === "stale") result.stale += 1;
      else result.failed += 1;
    } catch (err) {
      result.failed += 1;
      logger.error("unexpected error during token refresh", { accountId: c.accountId, err });
    }
  }
  return result;
}

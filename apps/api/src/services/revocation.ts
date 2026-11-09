// Metaのアンインストール通知（research.md R7、contracts/api.md の手順1〜7）
import { and, eq, lt } from "drizzle-orm";
import type { Env } from "../kernel/env";
import { createDb, withTransaction, type TxDb } from "../kernel/db/client";
import { lockThreadsUser } from "../kernel/db/locks";
import { accounts, threadsConnections, threadsRevocations } from "../db/schema";
import { createTokenCipher } from "../kernel/crypto";
import { threadsUserHmac } from "../kernel/identifier-hash";
import { logger } from "../kernel/logger";
import { ThreadsAuthError, type ThreadsClient } from "../adapters/threads-api";

/** アンインストール通知の中身。issuedAt は Meta が通知を発行した時刻（含まれていなければ undefined）。 */
export type UninstallPayload = { userId: string; issuedAt?: Date };

async function recordRevocation(tx: TxDb, hmac: string, issuedAt: Date, receivedAt: Date) {
  await tx.insert(threadsRevocations).values({ threadsUserHmac: hmac, issuedAt, receivedAt });
}

async function revokeConnection(tx: TxDb, accountId: string, generation: number) {
  const bumped = await tx
    .update(accounts)
    .set({ connectionStatus: "needs_reconnect", connectionGeneration: generation + 1, updatedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.connectionGeneration, generation)))
    .returning({ id: accounts.id });
  if (bumped.length > 0) await tx.delete(threadsConnections).where(eq(threadsConnections.accountId, accountId));
}

/**
 * Meta のアンインストール通知を処理する（research.md R7、contracts/api.md の手順1〜7）。
 * Accountの有無にかかわらず取り消しを記録し、ユーザーが最後に認可した時刻より前の通知は適用しない。
 * @param env - Workers のバインディング
 * @param threads - Threads API のクライアント（issued_at がないときの確認に使う）
 * @param payload - 検証済みの通知の中身
 * @param receivedAt - 通知を受け取った時刻
 */
export async function handleUninstall(env: Env, threads: ThreadsClient, payload: UninstallPayload, receivedAt: Date) {
  const hmac = await threadsUserHmac(env.IDENTIFIER_HASH_KEY, payload.userId);

  if (!payload.issuedAt) {
    // 時刻で判断できないので、現在のトークンでプロフィール取得を試す（手順7）
    const db = createDb(env.DATABASE_URL);
    const [row] = await db
      .select({ accountId: accounts.id, generation: accounts.connectionGeneration, conn: threadsConnections })
      .from(accounts)
      .innerJoin(threadsConnections, eq(threadsConnections.accountId, accounts.id))
      .where(eq(accounts.threadsUserId, payload.userId))
      .limit(1);
    let revoke = false;
    if (row) {
      try {
        const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
        const token = await cipher.decrypt(
          { ciphertext: row.conn.accessTokenCiphertext, iv: row.conn.accessTokenIv, keyVersion: row.conn.keyVersion },
          row.accountId,
        );
        await threads.getProfile(token);
      } catch (err) {
        if (err instanceof ThreadsAuthError) revoke = true;
        else logger.warn("uninstall check failed", { err });
      }
    }
    await withTransaction(env.DATABASE_URL, async (tx) => {
      await lockThreadsUser(tx, payload.userId);
      await recordRevocation(tx, hmac, receivedAt, receivedAt);
      if (row && revoke) await revokeConnection(tx, row.accountId, row.generation);
    });
    return;
  }

  const issuedAt = payload.issuedAt;
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockThreadsUser(tx, payload.userId);
    // Accountの有無にかかわらず記録する（進行中の callback が照合する）
    await recordRevocation(tx, hmac, issuedAt, receivedAt);
    const [row] = await tx
      .select({ accountId: accounts.id, generation: accounts.connectionGeneration, authorizedAt: threadsConnections.authorizedAt })
      .from(accounts)
      .innerJoin(threadsConnections, eq(threadsConnections.accountId, accounts.id))
      .where(eq(accounts.threadsUserId, payload.userId))
      .limit(1);
    if (!row) return;
    // その後に再認可された接続への古い通知は適用しない
    if (issuedAt.getTime() < row.authorizedAt.getTime()) return;
    await revokeConnection(tx, row.accountId, row.generation);
  });
}

/**
 * 受信から15分以上経った取り消しの記録を削除する（日次Cron）。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻
 * @returns 削除した件数
 */
export async function cleanupRevocations(env: Env, now: Date) {
  const deleted = await createDb(env.DATABASE_URL)
    .delete(threadsRevocations)
    .where(lt(threadsRevocations.receivedAt, new Date(now.getTime() - 15 * 60_000)))
    .returning({ id: threadsRevocations.id });
  return { deleted: deleted.length };
}

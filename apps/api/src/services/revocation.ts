// Metaのアンインストール通知（research.md R7、contracts/api.md の手順1〜7）
import { and, eq, lt } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction, type TxDb } from "../db/client";
import { lockThreadsUser } from "../db/locks";
import { accounts, threadsConnections, threadsRevocations } from "../db/schema";
import { createTokenCipher } from "../lib/crypto";
import { threadsUserHmac } from "../lib/identifier-hash";
import { logger } from "../lib/logger";
import { ThreadsAuthError, type ThreadsClient } from "../lib/threads-client";

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

/** 受信から15分以上経った取り消しの記録を削除する（日次Cron） */
export async function cleanupRevocations(env: Env, now: Date) {
  const deleted = await createDb(env.DATABASE_URL)
    .delete(threadsRevocations)
    .where(lt(threadsRevocations.receivedAt, new Date(now.getTime() - 15 * 60_000)))
    .returning({ id: threadsRevocations.id });
  return { deleted: deleted.length };
}

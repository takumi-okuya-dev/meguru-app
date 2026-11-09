// 投稿と投稿の権限の確認で使う、Threadsの接続（トークン・ユーザーID・世代番号）の読み出し（specs/005-auto-post）。
// 要再接続にするときは、001 R6 と同じく、読んだ時点の connection_generation を条件にする。
import { and, eq } from "drizzle-orm";
import type { Db } from "../kernel/db/client";
import { accounts, threadsConnections } from "../db/schema";
import type { Env } from "../kernel/env";
import { createTokenCipher } from "../kernel/crypto";
import { logger } from "../kernel/logger";

/** Threadsへの呼び出しに必要な、Accountの接続。 */
export type ThreadsCredentials = {
  accountId: string;
  generation: number;
  /** 復号したトークン。接続がない・復号できないときは null */
  token: string | null;
} & (
  | { connectionStatus: "connected" | "needs_reconnect"; threadsUserId: string }
  // 一度もつないでいない（specs/012 data-model.md）。Threadsに問い合わせない
  | { connectionStatus: "not_connected"; threadsUserId: null }
);

/**
 * Accountの接続を読み、トークンを復号する。鍵の設定ミスなどで復号できないときは token を null にする（001 R5）。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 接続。Accountがなければ null
 */
export async function loadThreadsCredentials(
  env: Env,
  db: Db,
  accountId: string,
): Promise<ThreadsCredentials | null> {
  const [row] = await db
    .select({ account: accounts, conn: threadsConnections })
    .from(accounts)
    .leftJoin(threadsConnections, eq(threadsConnections.accountId, accounts.id))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) return null;
  if (row.account.connectionStatus === "not_connected" || row.account.threadsUserId === null) {
    return {
      accountId,
      generation: row.account.connectionGeneration,
      token: null,
      connectionStatus: "not_connected",
      threadsUserId: null,
    };
  }
  let token: string | null = null;
  if (row.conn) {
    try {
      const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
      token = await cipher.decrypt(
        {
          ciphertext: row.conn.accessTokenCiphertext,
          iv: row.conn.accessTokenIv,
          keyVersion: row.conn.keyVersion,
        },
        accountId,
      );
    } catch (err) {
      logger.error("failed to decrypt threads token", { accountId, err });
    }
  }
  return {
    accountId,
    threadsUserId: row.account.threadsUserId,
    generation: row.account.connectionGeneration,
    connectionStatus: row.account.connectionStatus,
    token,
  };
}

/**
 * Accountを要再接続にする。読んだ時点の世代番号と同じときだけ（その間の再接続を上書きしない。001 R6）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param generation - 読んだ時点の connection_generation
 */
export async function markNeedsReconnect(
  db: Db,
  accountId: string,
  generation: number,
): Promise<void> {
  await db
    .update(accounts)
    .set({ connectionStatus: "needs_reconnect", updatedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.connectionGeneration, generation)));
}

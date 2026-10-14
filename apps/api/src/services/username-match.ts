// ユーザー名だけが一致したAccountの、今のユーザー名の確かめ（specs/010-token-account-add FR-023、research.md R6）。
// Threadsでは手放されたユーザー名を別の人が取れるので、名前だけの一致で二重登録と決めつけない。
import { normalizeUsername } from "@threads-grower/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import { createDb, withTransaction, type TxDb } from "../db/client";
import { lockThreadsUsername } from "../db/locks";
import { accounts } from "../db/schema";
import type { Env } from "../env";
import { logger } from "../lib/logger";
import type { ThreadsClient, ThreadsProfile } from "../lib/threads-client";
import { loadThreadsCredentials } from "./threads-credentials";

/**
 * ユーザーIDは違うがユーザー名が同じAccountを探し、保存済みのトークンでプロフィールを取り直す。名前が変わっていれば
 * そのAccountのユーザー名を新しくする。取り直せない（要再接続・復号できない・エラー）ときは何もしない（一致したまま）。
 * トランザクションの外で呼ぶ（Threadsへの問い合わせを含むため）。照合そのものは completeConnection の中で行う。
 * @param env - Workers のバインディング
 * @param threads - Threads API のクライアント
 * @param profile - 接続しようとしているThreadsアカウントのプロフィール
 */
export async function refreshUsernameOnlyMatch(env: Env, threads: ThreadsClient, profile: ThreadsProfile): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const matches = await db
    .select({ id: accounts.id, username: accounts.username })
    .from(accounts)
    .where(
      and(
        sql`lower(${accounts.username}) = ${normalizeUsername(profile.username)}`,
        ne(accounts.threadsUserId, profile.id),
      ),
    );
  for (const m of matches) {
    const cred = await loadThreadsCredentials(env, db, m.id);
    if (!cred?.token || cred.connectionStatus !== "connected") continue;
    try {
      const current = await threads.getProfile(cred.token);
      if (m.username !== null && normalizeUsername(current.username) === normalizeUsername(m.username)) continue;
      await withTransaction(env.DATABASE_URL, async (tx) => {
        await lockUsernameForUpdate(tx, m.id, current.username);
        // 世代番号を条件にし、その間の接続し直しを上書きしない
        await tx
          .update(accounts)
          .set({ username: current.username, displayName: current.name, updatedAt: new Date() })
          .where(and(eq(accounts.id, m.id), eq(accounts.connectionGeneration, cred.generation)));
      });
    } catch (err) {
      logger.info("could not refresh profile of username-only match", { accountId: m.id, kind: (err as Error).name });
    }
  }
}

/**
 * Accountのユーザー名を書き換える前に、新しい名前のアドバイザリーロックを取り、同じ名前の別のAccountがないかを照合する
 * （PR #12 のCodexレビュー）。接続の確定（completeConnection）も同じロックを取るので、書き換えの後に別のMetaアプリで
 * 新しい名前を追加しようとしても、照合で見つかる。先に別のAccountとして登録されていた（同じ人が別のアプリのIDで2行
 * 持つ）ときは、自動では1つにできないので、警告のログだけを残す（名前は事実に合わせて書き換える）。
 * 名前の取り直し（refreshUsernameOnlyMatch）と、日次のトークン更新（token-refresh）の両方で、書き換えと同じ
 * トランザクションの中で呼ぶ。
 * @param tx - 書き換えと同じトランザクション
 * @param accountId - 書き換えるAccount
 * @param username - 新しいユーザー名
 */
export async function lockUsernameForUpdate(tx: TxDb, accountId: string, username: string): Promise<void> {
  const next = normalizeUsername(username);
  await lockThreadsUsername(tx, next);
  const [other] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(sql`lower(${accounts.username}) = ${next}`, ne(accounts.id, accountId)))
    .limit(1);
  if (other) {
    logger.warn("username updated onto an already registered username", { accountId, otherAccountId: other.id });
  }
}

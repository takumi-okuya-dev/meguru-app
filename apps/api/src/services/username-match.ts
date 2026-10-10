// ユーザー名だけが一致したAccountの、今のユーザー名の確かめ（specs/010-token-account-add FR-023、research.md R6）。
// Threadsでは手放されたユーザー名を別の人が取れるので、名前だけの一致で二重登録と決めつけない。
import { normalizeUsername } from "@threads-grower/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import { createDb } from "../db/client";
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
      if (normalizeUsername(current.username) === normalizeUsername(m.username)) continue;
      // 世代番号を条件にし、その間の接続し直しを上書きしない
      await db
        .update(accounts)
        .set({ username: current.username, displayName: current.name, updatedAt: new Date() })
        .where(and(eq(accounts.id, m.id), eq(accounts.connectionGeneration, cred.generation)));
    } catch (err) {
      logger.info("could not refresh profile of username-only match", { accountId: m.id, kind: (err as Error).name });
    }
  }
}

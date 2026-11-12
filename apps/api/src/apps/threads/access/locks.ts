// Threadsの利用者ごとのロック（specs/meguru/029-threads-pattern1 tasks.md T036）。
// 以前は共通の users の行ロック（kernel/db/locks.ts の lockUserRow）で、アカウントの作成・削除・チームの作成・接続の確定などを
// 利用者ごとに直列にしていた。Threadsは共通の表を触らないので、同じ役目をThreadsのアドバイザリーロックで持つ。
// ロックの順序は今と同じ「Threadsユーザー → ユーザー名 → 利用者（このロック）」（specs/010 research.md R6）。
import { sql } from "drizzle-orm";
import type { TxDb } from "../../../kernel/db/client";

/**
 * Threadsの利用者ごとのアドバイザリーロックを取る。トランザクションの終わりで自動的に外れる。
 * @param tx - トランザクション
 * @param userId - 利用者の番号（共通の users.id）
 */
export async function lockThreadsMember(tx: TxDb, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"threads_member:" + userId}, 0))`);
}

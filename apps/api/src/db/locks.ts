// ロックの部品（research.md R8）。
// ロックの順序は、どの処理でも必ず「Threadsユーザー単位のアドバイザリーロック → users の行ロック」とする。
// 順序をそろえないと、callback とデータ削除処理が互いの持つロックを待ってデッドロックする。
import { sql } from "drizzle-orm";
import type { TxDb } from "./client";

/**
 * Threadsユーザー単位のアドバイザリーロックを取る。トランザクションの終わりで自動的に外れる。
 * @param tx - トランザクション
 * @param threadsUserId - ThreadsのユーザーID
 */
export async function lockThreadsUser(tx: TxDb, threadsUserId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"threads_user:" + threadsUserId}, 0))`);
}

/**
 * users の行ロックを取る。ユーザー単位の処理（上限の判定・Account削除）を直列化する。
 * @param tx - トランザクション
 * @param userId - users.id
 */
export async function lockUserRow(tx: TxDb, userId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
}

/**
 * 「Account × 下書き」のアドバイザリーロックを取る。トランザクションの終わりで自動的に外れる。
 * 一括登録（003）、状態の変更・承認済みの編集・NGワードの追加と削除（004）を直列化し、
 * 件数の上限と「NGワードを含む承認済みを残さない」（specs/004-review-approval research.md R3）を守る。
 * @param tx - トランザクション
 * @param accountId - accounts.id
 */
export async function lockAccountDrafts(tx: TxDb, accountId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account_items:${accountId}:post_drafts`}, 0))`);
}

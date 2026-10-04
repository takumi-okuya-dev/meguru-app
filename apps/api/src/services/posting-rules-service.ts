// 投稿のルール：NGワードと投稿ルール（CORE RULES）（specs/004-review-approval research.md R6・R11）。
import { asc, eq } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { ngWords } from "../db/schema";

type NgWordRow = typeof ngWords.$inferSelect;

/**
 * NGワードの行を、レスポンスの NgWord にする。
 * @param row - ng_words の行
 * @returns NgWord
 */
export function toNgWord(row: NgWordRow) {
  return { id: row.id, word: row.word, normalized: row.normalized, createdAt: row.createdAt.toISOString() };
}

/**
 * そのAccountのNGワードを、登録の古い順に読む。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns NGワードの行
 */
export async function listNgWords(db: Db | TxDb, accountId: string): Promise<NgWordRow[]> {
  return db.select().from(ngWords).where(eq(ngWords.accountId, accountId)).orderBy(asc(ngWords.createdAt), asc(ngWords.id));
}

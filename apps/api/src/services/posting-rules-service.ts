// 投稿のルール：NGワードと投稿ルール（CORE RULES）（specs/004-review-approval research.md R6・R11）。
import { NG_WORD_LIMIT, findNgWords, normalizeNgWord } from "@threads-grower/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../db/client";
import { lockAccountDrafts } from "../db/locks";
import { ngWords, postDrafts } from "../db/schema";
import type { Env } from "../env";
import { AppError, itemNotFound, notFound, pgErrorCode } from "../lib/errors";
import type { AccountRow } from "./access";
import { canEditProfile } from "./grower-access";

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

/**
 * 「このアカウントの設定」の「投稿のルール」に必要な値（GET /posting-rules）。
 * @param db - データベース
 * @param account - Account の行
 * @param user - リクエストしたユーザー（無料体験の判定に使う）
 * @returns NGワード・上限・投稿ルール・投稿ルールを編集できるか
 */
export async function getPostingRules(db: Db, account: AccountRow, user: { createdAt: Date }) {
  const rows = await listNgWords(db, account.id);
  return {
    ngWords: rows.map(toNgWord),
    ngWordLimit: NG_WORD_LIMIT,
    coreRules: account.coreRules,
    coreRulesVersion: account.coreRulesVersion,
    canEditCoreRules: canEditProfile(account, user),
  };
}

/**
 * NGワードを足す（FR-014・FR-016a、research.md R6）。空の語と重複（既存・同じ送信の中）を除き、
 * 足した語を含む承認済みの下書きを要確認に戻す。承認と同じロックで直列化する（R3）。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param words - 入力された語（スキーマで長さを確かめてあること）
 * @returns added：足した語、duplicates：重複で足さなかった語（入力のまま）、reopenedCount：要確認に戻した下書きの件数
 * @throws AppError ITEM_LIMIT_REACHED（200語を超える。何も足さない）、ACCOUNT_NOT_FOUND（途中でAccountが削除された）
 */
export async function addNgWords(env: Env, accountId: string, words: string[]) {
  try {
    return await withTransaction(env.DATABASE_URL, async (tx) => {
      await lockAccountDrafts(tx, accountId);
      const existing = await listNgWords(tx, accountId);
      const seen = new Set(existing.map((w) => w.normalized));
      const toAdd: { word: string; normalized: string }[] = [];
      const duplicates: string[] = [];
      for (const raw of words) {
        const word = raw.trim();
        if (word === "") continue;
        const normalized = normalizeNgWord(word);
        if (seen.has(normalized)) {
          duplicates.push(word);
          continue;
        }
        seen.add(normalized);
        toAdd.push({ word, normalized });
      }
      if (existing.length + toAdd.length > NG_WORD_LIMIT) {
        throw new AppError("ITEM_LIMIT_REACHED", 409, "item limit reached");
      }
      if (toAdd.length === 0) return { added: [], duplicates, reopenedCount: 0 };

      const added = await tx
        .insert(ngWords)
        .values(toAdd.map((w) => ({ accountId, ...w })))
        .returning();
      // 足した語を含む承認済みの下書きを要確認に戻す（「承認済み」は常にその時点のNGワードを通ったものだけにする）
      const approved = await tx
        .select({ id: postDrafts.id, body: postDrafts.body })
        .from(postDrafts)
        .where(and(eq(postDrafts.accountId, accountId), eq(postDrafts.status, "approved")));
      const hitIds = approved.filter((d) => findNgWords(d.body, toAdd).length > 0).map((d) => d.id);
      if (hitIds.length > 0) {
        await tx
          .update(postDrafts)
          .set({ status: "needs_review", reviewedAt: null, version: sql`${postDrafts.version} + 1`, updatedAt: new Date() })
          .where(and(eq(postDrafts.accountId, accountId), inArray(postDrafts.id, hitIds)));
      }
      added.sort((a, b) => toAdd.findIndex((w) => w.word === a.word) - toAdd.findIndex((w) => w.word === b.word));
      return { added: added.map(toNgWord), duplicates, reopenedCount: hitIds.length };
    });
  } catch (err) {
    // 外部キー違反：途中でAccountが削除された
    if (pgErrorCode(err) === "23503") throw notFound();
    throw err;
  }
}

/**
 * NGワードを1つ消す（FR-014）。要確認に戻した下書きはそのまま（自動で承認し直さない）。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param id - ng_words.id（UUID の形は確かめてあること）
 * @throws AppError ITEM_NOT_FOUND（ない・別のAccountのもの）
 */
export async function deleteNgWord(env: Env, accountId: string, id: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    // 承認のチェックと順序をそろえる（消した直後の承認が、消す前の語で止まらないように）
    await lockAccountDrafts(tx, accountId);
    const deleted = await tx
      .delete(ngWords)
      .where(and(eq(ngWords.id, id), eq(ngWords.accountId, accountId)))
      .returning({ id: ngWords.id });
    if (deleted.length === 0) throw itemNotFound();
  });
}

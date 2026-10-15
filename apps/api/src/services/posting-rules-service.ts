// 投稿のルール：NGワードと投稿ルール（CORE RULES）（specs/004-review-approval research.md R6・R11）。
import { NG_WORD_LIMIT, findNgWords, normalizeNgWord } from "@threads-grower/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../db/client";
import { lockAccountDrafts } from "../db/locks";
import { accounts, ngWords, postDrafts } from "../db/schema";
import type { Env } from "../env";
import { AppError, itemNotFound, notFound, pgErrorCode } from "../lib/errors";
import type { AccountRow } from "./access";
import { CLEAR_QUEUE_FIELDS } from "./draft-service";
import type { AccountAccess } from "./access";
import { recordActivity, updatedByOf } from "./activity-log";

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
  return db.select().from(ngWords).where(eq(ngWords.accountId, accountId)).orderBy(asc(ngWords.seq));
}

/**
 * 「このアカウントの設定」の「投稿のルール」に必要な値（GET /posting-rules）。
 * @param db - データベース
 * @param account - Account の行
 * @param canEditCoreRules - 投稿ルールを編集できるか（権限 settings。読むだけなら false。specs/013）
 * @returns NGワード・上限・投稿ルール・投稿ルールを編集できるか
 */
export async function getPostingRules(db: Db, account: AccountRow, canEditCoreRules: boolean) {
  const rows = await listNgWords(db, account.id);
  return {
    ngWords: rows.map(toNgWord),
    ngWordLimit: NG_WORD_LIMIT,
    coreRules: account.coreRules,
    coreRulesVersion: account.coreRulesVersion,
    canEditCoreRules,
  };
}

/**
 * NGワードを足す（FR-014・FR-016a、research.md R6）。空の語と重複（既存・同じ送信の中）を除き、
 * 足した語を含む承認済みの下書きを要確認に戻す。承認と同じロックで直列化する（R3）。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param words - 入力された語（スキーマで長さを確かめてあること）
 * @param access - 操作した人（操作の記録と、保存した人に使う。specs/008）。省略すると記録しない
 * @returns added：足した語、duplicates：重複で足さなかった語（入力のまま）、reopenedCount：要確認に戻した下書きの件数
 * @throws AppError ITEM_LIMIT_REACHED（200語を超える。何も足さない）、ACCOUNT_NOT_FOUND（途中でAccountが削除された）
 */
export async function addNgWords(env: Env, accountId: string, words: string[], access?: AccountAccess) {
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

      // 登録の順は seq（増え続ける番号）で持つ。1回の送信の中も、入力の順に番号が振られる
      const added = await tx
        .insert(ngWords)
        .values(toAdd.map((w) => ({ accountId, ...w })))
        .returning();
      // 足した語を含む承認済みの下書きを要確認に戻す（「承認済み」は常にその時点のNGワードを通ったものだけにする）。
      // 要確認の上限（500件）は確かめない。安全のため、該当するものはすべて戻す（要確認は最大で 500＋承認済み500 件になる。
      // data-model.md「件数の上限」、PR #5 のCodexレビュー）
      const approved = await tx
        .select({ id: postDrafts.id, body: postDrafts.body })
        .from(postDrafts)
        .where(and(eq(postDrafts.accountId, accountId), eq(postDrafts.status, "approved")));
      const hitIds = approved.filter((d) => findNgWords(d.body, toAdd).length > 0).map((d) => d.id);
      if (hitIds.length > 0) {
        await tx
          .update(postDrafts)
          .set({
            status: "needs_review",
            reviewedAt: null,
            lastReviewRequestId: null,
            // 要確認では、投稿の順の記録を持たない（005 data-model.md）
            ...CLEAR_QUEUE_FIELDS,
            version: sql`${postDrafts.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(postDrafts.accountId, accountId), inArray(postDrafts.id, hitIds)));
      }
      added.sort((a, b) => a.seq - b.seq);
      // すべて登録済みの語だけなら、変更していないので記録しない（PR #9 のCodexレビュー）
      if (access && added.length > 0) {
        await recordActivity(tx, access, {
          kind: "settings",
          action: "ng_word_added",
          itemCount: added.length,
          summary: added.map((w) => w.word).join("、"),
          ...(hitIds.length > 0 ? { details: { reopenedCount: hitIds.length } } : {}),
        });
      }
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
 * @param access - 操作した人（操作の記録と、保存した人に使う。specs/008）。省略すると記録しない
 * @throws AppError ITEM_NOT_FOUND（ない・別のAccountのもの）
 */
export async function deleteNgWord(env: Env, accountId: string, id: string, access?: AccountAccess): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    // 承認のチェックと順序をそろえる（消した直後の承認が、消す前の語で止まらないように）
    await lockAccountDrafts(tx, accountId);
    const deleted = await tx
      .delete(ngWords)
      .where(and(eq(ngWords.id, id), eq(ngWords.accountId, accountId)))
      .returning({ id: ngWords.id, word: ngWords.word });
    if (deleted.length === 0) throw itemNotFound();
    if (access) await recordActivity(tx, access, { kind: "settings", action: "ng_word_deleted", summary: deleted[0]!.word });
  });
}

/**
 * 投稿ルール（CORE RULES）を保存する（FR-019・FR-021、research.md R11）。全体の前後の空白だけを除き、
 * 読み込んだ版（expectedVersion）のときだけ更新する。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param req - text：投稿ルール、expectedVersion：読み込んだときの core_rules_version
 * @param access - 操作した人（操作の記録と、保存した人に使う。specs/008）。省略すると記録しない
 * @returns 保存した投稿ルールと版
 * @throws AppError STALE_UPDATE（他で先に保存された。latest 付き）、ACCOUNT_NOT_FOUND（Accountがない）
 */
export async function saveCoreRules(
  db: Db | TxDb,
  accountId: string,
  req: { text: string; expectedVersion: number },
  access?: AccountAccess,
) {
  // Db と TxDb のどちらでも型が合うよう、returning は列を指定せずに受けて取り出す
  const [saved] = await db
    .update(accounts)
    .set({
      coreRules: req.text.trim(),
      coreRulesVersion: sql`${accounts.coreRulesVersion} + 1`,
      // プロンプトの材料を最後に変えた日時（specs/006 research.md R9）
      coreRulesChangedAt: new Date(),
      ...(access ? { coreRulesUpdatedByUserId: access.actor.id } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.coreRulesVersion, req.expectedVersion)))
    .returning();
  if (saved) {
    if (access) await recordActivity(db, access, { kind: "settings", action: "core_rules_saved" });
    return { coreRules: saved.coreRules, coreRulesVersion: saved.coreRulesVersion };
  }
  const [current] = await db
    .select({
      coreRules: accounts.coreRules,
      coreRulesVersion: accounts.coreRulesVersion,
      by: accounts.coreRulesUpdatedByUserId,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!current) throw notFound();
  // 先に保存した人の名前を添える（specs/008 FR-007）
  throw new AppError(
    "STALE_UPDATE",
    409,
    "updated elsewhere",
    { coreRules: current.coreRules, coreRulesVersion: current.coreRulesVersion },
    undefined,
    { updatedBy: await updatedByOf(db, current.by) },
  );
}

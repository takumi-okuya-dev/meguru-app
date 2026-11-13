// 人物メモの持ち主の確かめと、作り手のロック（specs/people/001-people-memo contracts/api.md 0、research.md R5・R18）。
// 持ち主の判定はこのファイルに集める（Constitution原則V）。ほかの作り手のものは 404 ITEM_NOT_FOUND（あるかどうかを見せない。FR-032）。
import { and, eq, sql, type InferSelectModel } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { billingModeOf } from "../../kernel/config";
import type { Db, TxDb } from "../../kernel/db/client";
import type { Env } from "../../kernel/env";
import { AppError, itemNotFound } from "../../kernel/errors";
import { isUuid } from "../../kernel/validate";
import { loadAppEntitlement } from "../../platform";
import { PEOPLE_APP } from "./registry";
import {
  peopleContactLogs,
  peopleCustomFields,
  peopleEvents,
  peopleImports,
  peopleOutreaches,
  peoplePersons,
  peopleResponses,
  peopleTags,
} from "./schema";

/** 読む先（トランザクションの中でもよい）。 */
export type PeopleDb = Db | TxDb;

/**
 * 作り手ごとのアドバイザリーロックを取る（トランザクションの終わりで外れる）。同じ作り手の取り込み・取り消し・まとめる・分ける・消すを直列にする。
 * @param tx - トランザクション
 * @param userId - 作り手
 */
export async function lockOwner(tx: TxDb, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"people_owner:" + userId}, 0))`);
}

/**
 * 作り手のロックを取り、その人が退会の途中でないことを、ロックの中で確かめる（新しい行を作る書き込みの頭で呼ぶ）。
 * 退会の片づけ（onUserWithdrawn）も同じロックを取るので、片づけのあとに行が作り直されない（PR #111 の Codex レビュー）。
 * 関所を通ったあとで退会が始まった書き込みは、ここで 409 WITHDRAWAL_IN_PROGRESS にする。
 * @param tx - トランザクション
 * @param env - Workers のバインディング
 * @param userId - 作り手
 */
export async function lockActiveOwner(tx: TxDb, env: Env, userId: string): Promise<void> {
  await lockOwner(tx, userId);
  const owner = await loadAppEntitlement(tx, billingModeOf(env), userId, PEOPLE_APP);
  if (!owner || owner.withdrawn) throw new AppError("WITHDRAWAL_IN_PROGRESS", 409, "withdrawal in progress");
}

/**
 * 人の更新の時刻を今にする（タグ・連絡の記録・自由な項目・リンクを直したあと。一覧の「更新順」に効かせる。specs/people/002）。
 * @param tx - トランザクション
 * @param userId - 作り手
 * @param personId - 人
 */
export async function touchPerson(tx: TxDb, userId: string, personId: string): Promise<void> {
  await tx.update(peoplePersons).set({ updatedAt: new Date() }).where(and(eq(peoplePersons.id, personId), eq(peoplePersons.userId, userId)));
}

/** 作り手ごとの表（id と user_id の列を持つ）。 */
type OwnedTable = PgTable & { id: PgColumn; userId: PgColumn };

/**
 * 作り手の行を1つ読む。番号の形が違う・ない・ほかの作り手のものなら 404（あるかどうかを見せない。FR-032）。
 * @param db - データベース
 * @param table - 表
 * @param userId - 作り手
 * @param rowId - 行の番号
 * @returns 行
 */
export async function loadOwnedRow<T extends OwnedTable>(db: PeopleDb, table: T, userId: string, rowId: string): Promise<InferSelectModel<T>> {
  if (!isUuid(rowId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(table as PgTable)
    .where(and(eq(table.id, rowId), eq(table.userId, userId)));
  if (!row) throw itemNotFound();
  return row as InferSelectModel<T>;
}

/**
 * 作り手の中で、同じ名前（nameKey）の行がほかにあれば 409 PEOPLE_NAME_TAKEN（直すときは自分自身を除く。タグ・自由な項目）。
 * @param tx - トランザクション（作り手のロックの中で呼ぶ）
 * @param table - 表
 * @param keyColumn - nameKey の列
 * @param userId - 作り手
 * @param key - nameKey
 * @param exceptId - 除く行
 */
export async function assertKeyFree<T extends OwnedTable>(tx: TxDb, table: T, keyColumn: PgColumn, userId: string, key: string, exceptId?: string): Promise<void> {
  const [same] = await tx
    .select({ id: table.id })
    .from(table as PgTable)
    .where(and(eq(table.userId, userId), eq(keyColumn, key)));
  if (same && same.id !== exceptId) throw new AppError("PEOPLE_NAME_TAKEN", 409, "name taken");
}

/**
 * 作り手のイベントを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - 番号
 * @returns 行
 */
export const loadOwnedEvent = (db: PeopleDb, userId: string, eventId: string) => loadOwnedRow(db, peopleEvents, userId, eventId);
/**
 * 作り手の取り込みを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param importId - 番号
 * @returns 行
 */
export const loadOwnedImport = (db: PeopleDb, userId: string, importId: string) => loadOwnedRow(db, peopleImports, userId, importId);
/**
 * 作り手の人を読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 番号
 * @returns 行
 */
export const loadOwnedPerson = (db: PeopleDb, userId: string, personId: string) => loadOwnedRow(db, peoplePersons, userId, personId);
/**
 * 作り手の回答を読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param responseId - 番号
 * @returns 行
 */
export const loadOwnedResponse = (db: PeopleDb, userId: string, responseId: string) => loadOwnedRow(db, peopleResponses, userId, responseId);
/**
 * 作り手のタグを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param tagId - 番号
 * @returns 行
 */
export const loadOwnedTag = (db: PeopleDb, userId: string, tagId: string) => loadOwnedRow(db, peopleTags, userId, tagId);
/**
 * 作り手の自由な項目を読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param fieldId - 番号
 * @returns 行
 */
export const loadOwnedField = (db: PeopleDb, userId: string, fieldId: string) => loadOwnedRow(db, peopleCustomFields, userId, fieldId);
/**
 * 作り手の連絡の記録を読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param logId - 番号
 * @returns 行
 */
export const loadOwnedLog = (db: PeopleDb, userId: string, logId: string) => loadOwnedRow(db, peopleContactLogs, userId, logId);
/**
 * 作り手の声かけを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param outreachId - 番号
 * @returns 行
 */
export const loadOwnedOutreach = (db: PeopleDb, userId: string, outreachId: string) => loadOwnedRow(db, peopleOutreaches, userId, outreachId);

/**
 * 表示名（本名、なければ今のLINE名）。
 * @param p - 人
 * @returns 表示名
 */
export function displayNameOf(p: { realName: string | null; lineName: string | null }): string {
  return p.realName ?? p.lineName ?? "";
}

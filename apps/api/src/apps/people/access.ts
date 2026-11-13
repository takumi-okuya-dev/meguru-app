// 人物メモの持ち主の確かめと、作り手のロック（specs/people/001-people-memo contracts/api.md 0、research.md R5・R18）。
// 持ち主の判定はこのファイルに集める（Constitution原則V）。ほかの作り手のものは 404 ITEM_NOT_FOUND（あるかどうかを見せない。FR-032）。
import { and, eq, sql } from "drizzle-orm";
import type { Db, TxDb } from "../../kernel/db/client";
import { itemNotFound } from "../../kernel/errors";
import { isUuid } from "../../kernel/validate";
import { peopleEvents, peopleImports, peoplePersons, peopleResponses } from "./schema";

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
 * 作り手のイベントを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - イベントの番号
 * @returns イベントの行
 */
export async function loadOwnedEvent(db: PeopleDb, userId: string, eventId: string) {
  if (!isUuid(eventId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(peopleEvents)
    .where(and(eq(peopleEvents.id, eventId), eq(peopleEvents.userId, userId)));
  if (!row) throw itemNotFound();
  return row;
}

/**
 * 作り手の取り込みを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param importId - 取り込みの番号
 * @returns 取り込みの行
 */
export async function loadOwnedImport(db: PeopleDb, userId: string, importId: string) {
  if (!isUuid(importId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(peopleImports)
    .where(and(eq(peopleImports.id, importId), eq(peopleImports.userId, userId)));
  if (!row) throw itemNotFound();
  return row;
}

/**
 * 作り手の人を読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人の番号
 * @returns 人の行
 */
export async function loadOwnedPerson(db: PeopleDb, userId: string, personId: string) {
  if (!isUuid(personId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(peoplePersons)
    .where(and(eq(peoplePersons.id, personId), eq(peoplePersons.userId, userId)));
  if (!row) throw itemNotFound();
  return row;
}

/**
 * 作り手の回答を読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param responseId - 回答の番号
 * @returns 回答の行
 */
export async function loadOwnedResponse(db: PeopleDb, userId: string, responseId: string) {
  if (!isUuid(responseId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(peopleResponses)
    .where(and(eq(peopleResponses.id, responseId), eq(peopleResponses.userId, userId)));
  if (!row) throw itemNotFound();
  return row;
}

/**
 * 表示名（本名、なければ今のLINE名）。
 * @param p - 人
 * @returns 表示名
 */
export function displayNameOf(p: { realName: string | null; lineName: string | null }): string {
  return p.realName ?? p.lineName ?? "";
}

// イベント（specs/people/001-people-memo contracts/api.md 2、data-model.md 4、research.md R12・R14）。
// 参加者数＝その会の来た記録の人数（回答 ∪ 手で足した会ったイベント）＋消した人の来た記録の行数。毎回数える。
import type { EventDeletePreview, PeopleAttendee, PeopleEvent, PeopleEventDetail, PeopleEventListItem, UndoResult } from "@meguru/shared/people";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { withTransaction, type Db } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { logger } from "../../../kernel/logger";
import { displayNameOf, loadOwnedEvent, lockOwner, type PeopleDb } from "../access";
import { executeUndo, planUndo, toUndoPreview } from "../imports/undo";
import { peopleErasedAttendances, peopleEvents, peopleImports, peopleManualAttendances, peoplePersons, peopleResponses } from "../schema";
import { reportPeopleUsage } from "../usage";

/**
 * イベントの行を返りの形にする。
 * @param e - イベントの行
 * @returns イベント
 */
export function toEvent(e: typeof peopleEvents.$inferSelect): PeopleEvent {
  return { id: e.id, name: e.name, heldOn: e.heldOn, isOwn: e.isOwn };
}

/** イベントごとの数。 */
type EventCounts = { attendees: number; erased: number; imports: number };

/**
 * イベントごとの数を、まとめて数える（来た人＝回答 ∪ 手で足した会ったイベントの人の数、消した人の来た記録の数、取り込みの数）。
 * 参加者数は attendees + erased（data-model.md 4）。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - 1つのイベントだけ数えるとき
 * @returns イベントの番号 → 数
 */
async function countsByEvent(db: PeopleDb, userId: string, eventId?: string): Promise<Map<string, EventCounts>> {
  const only = (col: SQL) => (eventId ? sql` AND ${col} = ${eventId}` : sql``);
  const res = await db.execute<{ event_id: string; kind: string; n: number }>(sql`
    SELECT a.event_id, 'attendees' AS kind, count(*)::int AS n FROM (
      SELECT r.event_id, r.person_id FROM ${peopleResponses} r WHERE r.user_id = ${userId}${only(sql`r.event_id`)}
      UNION
      SELECT m.event_id, m.person_id FROM ${peopleManualAttendances} m WHERE m.user_id = ${userId}${only(sql`m.event_id`)}
    ) a GROUP BY a.event_id
    UNION ALL
    SELECT e.event_id, 'erased', count(*)::int FROM ${peopleErasedAttendances} e WHERE e.user_id = ${userId}${only(sql`e.event_id`)} GROUP BY e.event_id
    UNION ALL
    SELECT i.event_id, 'imports', count(*)::int FROM ${peopleImports} i WHERE i.user_id = ${userId}${only(sql`i.event_id`)} GROUP BY i.event_id`);
  const out = new Map<string, EventCounts>();
  for (const r of res.rows) {
    const c = out.get(r.event_id) ?? { attendees: 0, erased: 0, imports: 0 };
    c[r.kind as keyof EventCounts] = Number(r.n);
    out.set(r.event_id, c);
  }
  return out;
}

/**
 * 作り手のイベントの一覧（開催日の新しい順）。
 * @param db - データベース
 * @param userId - 作り手
 * @returns イベントと参加者数・取り込みの数
 */
export async function listEvents(db: Db, userId: string): Promise<PeopleEventListItem[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(peopleEvents).where(eq(peopleEvents.userId, userId)).orderBy(desc(peopleEvents.heldOn), desc(peopleEvents.createdAt)),
    countsByEvent(db, userId),
  ]);
  return rows.map((e) => {
    const c = counts.get(e.id);
    return { ...toEvent(e), attendeeCount: (c?.attendees ?? 0) + (c?.erased ?? 0), importCount: c?.imports ?? 0 };
  });
}

/**
 * イベントを作る。
 * @param db - データベース
 * @param userId - 作り手
 * @param input - 名前・開催日・自分の会か
 * @returns 作ったイベント
 */
export async function createEvent(db: Db, userId: string, input: { name: string; heldOn: string; isOwn: boolean }): Promise<PeopleEvent> {
  const [row] = await db.insert(peopleEvents).values({ userId, ...input }).returning();
  await reportPeopleUsage(db, userId);
  return toEvent(row!);
}

/**
 * イベントを直す。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - イベント
 * @param input - 直す項目
 * @returns 直したイベント
 */
export async function updateEvent(db: Db, userId: string, eventId: string, input: { name?: string; heldOn?: string; isOwn?: boolean }): Promise<PeopleEvent> {
  await loadOwnedEvent(db, userId, eventId);
  const [row] = await db
    .update(peopleEvents)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(peopleEvents.id, eventId), eq(peopleEvents.userId, userId)))
    .returning();
  return toEvent(row!);
}

/**
 * イベントのページ（数字と取り込みの一覧）。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - イベント
 * @returns イベント・数字・取り込み
 */
export async function eventDetail(db: Db, userId: string, eventId: string): Promise<PeopleEventDetail> {
  const event = await loadOwnedEvent(db, userId, eventId);
  const [counts, imports] = await Promise.all([
    countsByEvent(db, userId, eventId),
    db
      .select()
      .from(peopleImports)
      .where(and(eq(peopleImports.eventId, eventId), eq(peopleImports.userId, userId)))
      .orderBy(desc(peopleImports.createdAt)),
  ]);
  const c = counts.get(eventId);
  return {
    event: toEvent(event),
    stats: { attendeeCount: (c?.attendees ?? 0) + (c?.erased ?? 0), erasedCount: c?.erased ?? 0 },
    imports: imports.map((i) => ({
      id: i.id,
      createdAt: i.createdAt.toISOString(),
      rowCount: i.rowCount,
      importedCount: i.importedCount,
      createdPeopleCount: i.createdPeopleCount,
      linkedCount: i.linkedCount,
      skippedCount: i.skippedCount,
    })),
  };
}

/**
 * その会に来た人（名前の順）。回答で来た人は via: response、手で足した人は via: manual。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - イベント
 * @returns 来た人
 */
export async function eventAttendees(db: Db, userId: string, eventId: string): Promise<PeopleAttendee[]> {
  await loadOwnedEvent(db, userId, eventId);
  const res = await db.execute<{ id: string; real_name: string | null; line_name: string | null; by_response: boolean }>(sql`
    SELECT p.id, p.real_name, p.line_name,
      EXISTS (SELECT 1 FROM ${peopleResponses} r WHERE r.person_id = p.id AND r.event_id = ${eventId}) AS by_response
    FROM ${peoplePersons} p
    WHERE p.user_id = ${userId}
      AND (EXISTS (SELECT 1 FROM ${peopleResponses} r WHERE r.person_id = p.id AND r.event_id = ${eventId})
        OR EXISTS (SELECT 1 FROM ${peopleManualAttendances} m WHERE m.person_id = p.id AND m.event_id = ${eventId}))
    ORDER BY coalesce(p.real_name, p.line_name), p.id`);
  return res.rows.map((r) => ({
    personId: r.id,
    displayName: displayNameOf({ realName: r.real_name, lineName: r.line_name }),
    lineName: r.line_name,
    via: r.by_response ? ("response" as const) : ("manual" as const),
  }));
}

/**
 * そのイベントの取り込みの番号。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - イベント
 * @returns 取り込みの番号
 */
async function importIdsOf(db: PeopleDb, userId: string, eventId: string): Promise<string[]> {
  const rows = await db
    .select({ id: peopleImports.id })
    .from(peopleImports)
    .where(and(eq(peopleImports.eventId, eventId), eq(peopleImports.userId, userId)));
  return rows.map((r) => r.id);
}

/**
 * イベントを消す前の見積もり（取り込みをすべて取り消したときと同じ形＋取り込みの数・声かけの数）。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - イベント
 * @returns 見積もり
 */
export async function eventDeletePreview(db: Db, userId: string, eventId: string): Promise<EventDeletePreview> {
  await loadOwnedEvent(db, userId, eventId);
  const ids = await importIdsOf(db, userId, eventId);
  const plan = await planUndo(db, userId, ids, eventId);
  // 声かけ（PR3）の数は、声かけの表を作るときに足す
  return { ...toUndoPreview(plan), importCount: ids.length, outreachCount: 0 };
}

/**
 * イベントを消す：そのイベントの取り込みをすべて取り消してから、イベントを消す（手で足した会ったイベント・消した人の数は外部キーで消える）。
 * @param env - Workers のバインディング
 * @param db - データベース（利用の数を伝える）
 * @param userId - 作り手
 * @param eventId - イベント
 * @param keep - 書き足しのある人を残すか
 * @returns 消した人と残した人の数
 */
export async function deleteEvent(env: Env, db: Db, userId: string, eventId: string, keep: boolean | undefined): Promise<UndoResult> {
  const result = await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    await loadOwnedEvent(tx, userId, eventId);
    const ids = await importIdsOf(tx, userId, eventId);
    const r = await executeUndo(tx, userId, ids, keep, eventId);
    await tx.delete(peopleEvents).where(and(eq(peopleEvents.id, eventId), eq(peopleEvents.userId, userId)));
    return r;
  });
  logger.info("people event deleted", { eventId, removedPeople: result.removedPeopleCount });
  await reportPeopleUsage(db, userId);
  return result;
}

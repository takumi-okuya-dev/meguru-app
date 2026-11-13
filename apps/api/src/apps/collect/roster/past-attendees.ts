// 前回の参加者の候補（specs/collect/001-event-day-collection contracts/api.md 3、FR-027、research.md R9、tasks.md T026）。
// 主催者の、いまのイベントより前に開いたイベントの名簿から、name_key ごとに最後のもの（開催日時が一番新しいイベント）を選び、
// name_key か kana_key の部分一致で返す。
// いまのイベントの名簿にいる人と、ほかの主催者の名簿は出さない。
import { COLLECT_LIMITS, nameKey, type PastAttendee } from "@meguru/shared";
import { and, desc, eq, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { loadOwnedEvent } from "../access";
import { collectEvents, collectRosterPeople } from "../schema";

/**
 * LIKE の中で特別な意味を持つ文字（% _ \）を、ふつうの文字として扱うように直す。
 * @param s - 文字列
 * @returns 直した文字列
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 前回の参加者の候補を、最後に来たイベントの新しい順に最大5件返す。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - いま名簿を入れているイベント
 * @param q - 入れ始めた名前かふりがな（1文字以上）
 * @returns 候補
 * @throws AppError ITEM_NOT_FOUND（ない・ほかの主催者のイベント）
 */
export async function findPastAttendees(db: Db, ownerUserId: string, eventId: string, q: string): Promise<PastAttendee[]> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const key = nameKey(q);
  if (key === "") return [];
  const pattern = `%${escapeLike(key)}%`;
  const here = db.select({ nameKey: collectRosterPeople.nameKey }).from(collectRosterPeople).where(eq(collectRosterPeople.eventId, event.id));
  // 同じ名前ごとに、いまのイベントより前に開いたイベントのうち一番新しいもの（FR-027「過去のイベント」）
  const latest = db
    .selectDistinctOn([collectRosterPeople.nameKey], {
      name: sql<string>`${collectRosterPeople.name}`.as("person_name"),
      kana: sql<string | null>`${collectRosterPeople.kana}`.as("person_kana"),
      lastEventName: sql<string>`${collectEvents.name}`.as("last_event_name"),
      lastEventStartsAt: sql<Date>`${collectEvents.startsAt}`.as("last_event_starts_at"),
    })
    .from(collectRosterPeople)
    .innerJoin(collectEvents, eq(collectEvents.id, collectRosterPeople.eventId))
    .where(
      and(
        eq(collectEvents.ownerUserId, ownerUserId),
        lt(collectEvents.startsAt, event.startsAt),
        or(sql`${collectRosterPeople.nameKey} LIKE ${pattern}`, sql`${collectRosterPeople.kanaKey} LIKE ${pattern}`),
        notInArray(collectRosterPeople.nameKey, here),
      ),
    )
    .orderBy(collectRosterPeople.nameKey, desc(collectEvents.startsAt), desc(collectRosterPeople.createdAt))
    .as("latest");
  // 最後に来たイベントの新しい順に、5件だけ読む
  const rows = await db.select().from(latest).orderBy(desc(latest.lastEventStartsAt), latest.name).limit(COLLECT_LIMITS.pastAttendees);
  return rows.map((r) => ({
    name: r.name,
    kana: r.kana,
    lastEventName: r.lastEventName,
    lastEventStartsAt: new Date(r.lastEventStartsAt).toISOString(),
  }));
}

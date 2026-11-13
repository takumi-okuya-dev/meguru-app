// イベントを消す・イベントのまとめ（specs/collect/001-event-day-collection contracts/api.md 2、FR-011・FR-014、research.md R11、tasks.md T070）。
// 同じトランザクションで、数字だけのまとめを書いてからイベントを消す（料金の区分・名簿・記録・リンク・手伝う人・精算は CASCADE で消える）。
// まとめには、参加者の名前・手伝う人の名前を入れない。
import type { EventSummary } from "@meguru/shared";
import { and, desc, eq } from "drizzle-orm";
import { withTransaction, type Db } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent } from "../access";
import { tally } from "../closing/tally";
import { collectEventSummaries, collectEvents, collectReceptionRecords, collectRosterPeople } from "../schema";

/**
 * まとめの行を応答の形にする。
 * @param row - event_summaries の行
 * @returns まとめ
 */
function toSummary(row: typeof collectEventSummaries.$inferSelect): EventSummary {
  return {
    id: row.id,
    name: row.name,
    startsAt: row.startsAt.toISOString(),
    rosterCount: row.rosterCount,
    attendedCount: row.attendedCount,
    byMethod: row.byMethod,
    byMedia: row.byMedia,
    awaitingTransfer: row.awaitingTransfer,
    eventDeletedAt: row.eventDeletedAt.toISOString(),
  };
}

/**
 * イベントを消し、まとめを残す（DELETE /api/collect/events/:eventId）。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns まとめの番号と、消す前の版
 */
export async function deleteEvent(databaseUrl: string, ownerUserId: string, eventId: string): Promise<{ summaryId: string; version: number }> {
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    const [people, records] = await Promise.all([
      tx.select({ id: collectRosterPeople.id, media: collectRosterPeople.media }).from(collectRosterPeople).where(eq(collectRosterPeople.eventId, event.id)),
      tx
        .select({
          rosterPersonId: collectReceptionRecords.rosterPersonId,
          method: collectReceptionRecords.method,
          amount: collectReceptionRecords.amount,
          paymentStatus: collectReceptionRecords.paymentStatus,
        })
        .from(collectReceptionRecords)
        .where(eq(collectReceptionRecords.eventId, event.id)),
    ]);
    const t = tally(people, records);
    const [summary] = await tx
      .insert(collectEventSummaries)
      .values({
        ownerUserId,
        name: event.name,
        startsAt: event.startsAt,
        rosterCount: t.attendance.rosterCount,
        attendedCount: t.attendance.arrived,
        byMethod: t.byMethod,
        byMedia: t.byMedia,
        awaitingTransfer: t.transfers.awaiting,
      })
      .returning({ id: collectEventSummaries.id });
    await tx.delete(collectEvents).where(eq(collectEvents.id, event.id));
    return { summaryId: summary!.id, version: event.version };
  });
}

/**
 * 消したイベントのまとめの一覧（GET /api/collect/summaries。開催日の新しい順）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @returns まとめの一覧
 */
export async function listSummaries(db: Db, ownerUserId: string): Promise<EventSummary[]> {
  const rows = await db.select().from(collectEventSummaries).where(eq(collectEventSummaries.ownerUserId, ownerUserId)).orderBy(desc(collectEventSummaries.startsAt));
  return rows.map(toSummary);
}

/**
 * まとめも消す（DELETE /api/collect/summaries/:summaryId）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param summaryId - まとめの番号
 * @throws AppError ITEM_NOT_FOUND
 */
export async function deleteSummary(db: Db, ownerUserId: string, summaryId: string): Promise<void> {
  const rows = isUuid(summaryId)
    ? await db
        .delete(collectEventSummaries)
        .where(and(eq(collectEventSummaries.id, summaryId), eq(collectEventSummaries.ownerUserId, ownerUserId)))
        .returning({ id: collectEventSummaries.id })
    : [];
  if (rows.length === 0) throw new AppError("ITEM_NOT_FOUND", 404, "summary not found");
}

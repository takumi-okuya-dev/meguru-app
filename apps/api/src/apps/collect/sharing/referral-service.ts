// 紹介経由の売上と、紹介した人の候補（specs/collect/003-revenue-sharing contracts/api.md 1-5、FR-020〜FR-022、research.md R4）。
// 見るだけで、分配の計算には使わない（2026-11-14）。
import { SHARING_LIMITS, referrerKey, type ReferralRow } from "@meguru/shared";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { loadOwnedEvent } from "../access";
import { collectEvents, collectReceptionRecords, collectRosterPeople } from "../schema";
import { referralRows } from "./money";

/**
 * 紹介経由の売上（GET …/referrals）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns 紹介した人ごとの行
 */
export async function listReferrals(db: Db, ownerUserId: string, eventId: string): Promise<ReferralRow[]> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const [people, records] = await Promise.all([
    db
      .select({ id: collectRosterPeople.id, number: collectRosterPeople.number, referrer: collectRosterPeople.referrer, referrerKey: collectRosterPeople.referrerKey })
      .from(collectRosterPeople)
      .where(eq(collectRosterPeople.eventId, event.id)),
    db
      .select({
        rosterPersonId: collectReceptionRecords.rosterPersonId,
        method: collectReceptionRecords.method,
        amount: collectReceptionRecords.amount,
        paymentStatus: collectReceptionRecords.paymentStatus,
      })
      .from(collectReceptionRecords)
      .where(eq(collectReceptionRecords.eventId, event.id)),
  ]);
  return referralRows(people, records);
}

/**
 * 紹介した人の候補（GET /referrers）。この主催者のイベントで使った名前を、新しい順に同じ形をまとめて20件。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @returns 名前
 */
export async function referrerSuggestions(db: Db, ownerUserId: string): Promise<string[]> {
  const rows = await db
    .select({ referrer: collectRosterPeople.referrer })
    .from(collectRosterPeople)
    .innerJoin(collectEvents, eq(collectEvents.id, collectRosterPeople.eventId))
    .where(and(eq(collectEvents.ownerUserId, ownerUserId), isNotNull(collectRosterPeople.referrer)))
    .orderBy(desc(collectRosterPeople.createdAt))
    .limit(500);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const { referrer } of rows) {
    const key = referrerKey(referrer!);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(referrer!);
    if (names.length >= SHARING_LIMITS.referrerSuggestions) break;
  }
  return names;
}

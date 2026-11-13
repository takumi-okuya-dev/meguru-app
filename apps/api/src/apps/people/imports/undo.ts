// 取り込みの取り消しと、イベントを消す（specs/people/001-people-memo research.md R14、contracts/api.md 2・3-3）。
// 取り消すと、その取り込みの回答と、その取り込みだけで作られた人（ほかの回答も手で足した会ったイベントも残らない人）が消える。
// 書き足しのある人（メモ・声かけ・手で直した同意・手で足した会ったイベント）がいれば、残すか消すかを作り手が選ぶ。
import type { PersonNote, UndoResult } from "@meguru/shared/people";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { displayNameOf, type PeopleDb } from "../access";
import { derivePersons } from "../persons/person-derive";
import { peopleConsentChanges, peopleImports, peopleManualAttendances, peoplePersons, peopleResponses } from "../schema";

/** 取り消しの見積もり。 */
export type UndoPlan = {
  /** 取り消す回答の数 */
  responseCount: number;
  /** 回答が動く人（取り消しのあとで決め直す） */
  affected: string[];
  /** 取り消すと消える人 */
  removable: string[];
  /** そのうち書き足しのある人 */
  peopleWithNotes: { personId: string; displayName: string; notes: PersonNote[] }[];
};

/**
 * 取り消しの見積もりを作る（何も書かない）。
 * @param db - データベース（書く前の確かめではトランザクション）
 * @param userId - 作り手
 * @param importIds - 取り消す取り込み（イベントを消すときは、そのイベントのすべて）
 * @returns 見積もり
 */
export async function planUndo(db: PeopleDb, userId: string, importIds: readonly string[]): Promise<UndoPlan> {
  if (importIds.length === 0) return { responseCount: 0, affected: [], removable: [], peopleWithNotes: [] };
  const ids = [...importIds];
  const [responses, created] = await Promise.all([
    db
      .select({ personId: peopleResponses.personId })
      .from(peopleResponses)
      .where(and(eq(peopleResponses.userId, userId), inArray(peopleResponses.importId, ids))),
    // その取り込みで作られ、ほかの取り込みの回答も手で足した会ったイベントもない人
    db
      .select({ id: peoplePersons.id, realName: peoplePersons.realName, lineName: peoplePersons.lineName, memoAppearance: peoplePersons.memoAppearance, memoTalk: peoplePersons.memoTalk })
      .from(peoplePersons)
      .where(
        and(
          eq(peoplePersons.userId, userId),
          inArray(peoplePersons.createdByImportId, ids),
          sql`NOT EXISTS (SELECT 1 FROM ${peopleResponses} r WHERE r.person_id = ${peoplePersons.id} AND NOT (${inArray(sql`r.import_id`, ids)}))`,
          sql`NOT EXISTS (SELECT 1 FROM ${peopleManualAttendances} m WHERE m.person_id = ${peoplePersons.id})`,
        ),
      ),
  ]);
  const removable = created.map((p) => p.id);
  const manualConsent = removable.length
    ? new Set(
        (
          await db
            .selectDistinct({ personId: peopleConsentChanges.personId })
            .from(peopleConsentChanges)
            .where(and(inArray(peopleConsentChanges.personId, removable), eq(peopleConsentChanges.source, "manual")))
        ).map((r) => r.personId),
      )
    : new Set<string>();
  // 声かけ（PR3）の書き足しは、声かけの表を作るときに足す
  const peopleWithNotes = created
    .map((p) => {
      const notes: PersonNote[] = [];
      if (p.memoAppearance || p.memoTalk) notes.push("memo");
      if (manualConsent.has(p.id)) notes.push("manual_consent");
      return { personId: p.id, displayName: displayNameOf(p), notes };
    })
    .filter((p) => p.notes.length > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
  return { responseCount: responses.length, affected: [...new Set(responses.map((r) => r.personId))], removable, peopleWithNotes };
}

/**
 * 取り消す（作り手のロックの中で呼ぶ）。書き足しのある人がいて keep を省いたら 409 PEOPLE_CONFIRM_REQUIRED。
 * @param tx - トランザクション（作り手のロックを取ったもの）
 * @param userId - 作り手
 * @param importIds - 取り消す取り込み
 * @param keep - 書き足しのある人を残すか（省くと、いれば 409）
 * @returns 消した人と残した人の数
 */
export async function executeUndo(tx: TxDb, userId: string, importIds: readonly string[], keep: boolean | undefined): Promise<UndoResult> {
  const plan = await planUndo(tx, userId, importIds);
  if (plan.peopleWithNotes.length > 0 && keep === undefined) {
    throw new AppError("PEOPLE_CONFIRM_REQUIRED", 409, "people confirm required", undefined, undefined, { count: plan.peopleWithNotes.length });
  }
  const kept = new Set(keep ? plan.peopleWithNotes.map((p) => p.personId) : []);
  const removed = plan.removable.filter((id) => !kept.has(id));
  if (removed.length > 0) await tx.delete(peoplePersons).where(and(eq(peoplePersons.userId, userId), inArray(peoplePersons.id, removed)));
  if (importIds.length > 0) await tx.delete(peopleImports).where(and(eq(peopleImports.userId, userId), inArray(peopleImports.id, [...importIds])));
  const removedSet = new Set(removed);
  await derivePersons(
    tx,
    userId,
    plan.affected.filter((id) => !removedSet.has(id)),
  );
  return { removedPeopleCount: removed.length, keptPeopleCount: kept.size };
}

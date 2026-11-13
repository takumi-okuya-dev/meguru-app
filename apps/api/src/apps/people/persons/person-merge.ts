// まとめる・分ける（specs/people/001-people-memo contracts/api.md 4、research.md R15、tasks.md T061・T062）。
import { MEMO_APPEARANCE_MAX, MEMO_TALK_MAX, nameKey, type PersonSummary } from "@meguru/shared/people";
import { and, count, eq, sql } from "drizzle-orm";
import { withTransaction } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError } from "../../../kernel/errors";
import { loadOwnedPerson, loadOwnedResponse, lockOwner } from "../access";
import { peopleConsentChanges, peopleManualAttendances, peoplePersons, peopleResponses } from "../schema";
import { derivePersons } from "./person-derive";
import { personSummary } from "./person-service";

/** メモをつなぐ区切り（R15）。 */
const MEMO_JOIN = " ／ ";

/**
 * 2つのメモをつなぐ（両方にあれば「残す人 ／ 相手」。上限を超える分は相手の方を切る。文字の数で数える）。
 * @param keep - 残す人のメモ
 * @param other - 相手のメモ
 * @param max - 上限
 * @returns つないだメモ
 */
export function joinMemo(keep: string | null, other: string | null, max: number): string | null {
  if (!keep) return other ? [...other].slice(0, max).join("") : null;
  if (!other) return keep;
  const joined = [...`${keep}${MEMO_JOIN}${other}`];
  if (joined.length <= max) return joined.join("");
  // 相手の分が1文字も入らないなら、残す人のメモだけ
  if ([...keep].length + [...MEMO_JOIN].length >= max) return keep;
  return joined.slice(0, max).join("");
}

/**
 * 2人をまとめる。`personId` を残し、相手の回答・手で足した会ったイベント（重なりは1つ）・同意の記録を移して、相手を消す（R15）。
 * 人は減るが来た記録は残るので、参加者数は変わらない（erased_* は作らない）。声かけの移し替えは PR3 で足す。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 残す人
 * @param otherPersonId - 相手
 * @returns 残した人
 */
export async function mergePersons(env: Env, userId: string, personId: string, otherPersonId: string): Promise<PersonSummary> {
  if (personId === otherPersonId) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["otherPersonId"]);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const keep = await loadOwnedPerson(tx, userId, personId);
    const other = await loadOwnedPerson(tx, userId, otherPersonId);
    await tx.update(peopleResponses).set({ personId: keep.id }).where(and(eq(peopleResponses.personId, other.id), eq(peopleResponses.userId, userId)));
    await tx.execute(sql`INSERT INTO ${peopleManualAttendances} (person_id, event_id, user_id, created_at)
      SELECT ${keep.id}, m.event_id, m.user_id, m.created_at FROM ${peopleManualAttendances} m WHERE m.person_id = ${other.id}
      ON CONFLICT DO NOTHING`);
    await tx
      .update(peopleConsentChanges)
      .set({ personId: keep.id })
      .where(and(eq(peopleConsentChanges.personId, other.id), eq(peopleConsentChanges.userId, userId)));
    const realName = keep.realName ?? other.realName;
    const enteredLineName = keep.enteredLineName ?? other.enteredLineName;
    // 相手を先に消す（手で足した会ったイベントは外部キーで一緒に消える。移した分は上で写した）
    await tx.delete(peoplePersons).where(and(eq(peoplePersons.id, other.id), eq(peoplePersons.userId, userId)));
    await tx
      .update(peoplePersons)
      .set({
        realName,
        realNameKey: realName ? nameKey(realName) : null,
        enteredLineName,
        enteredLineNameKey: enteredLineName ? nameKey(enteredLineName) : null,
        memoAppearance: joinMemo(keep.memoAppearance, other.memoAppearance, MEMO_APPEARANCE_MAX),
        memoTalk: joinMemo(keep.memoTalk, other.memoTalk, MEMO_TALK_MAX),
        updatedAt: new Date(),
      })
      .where(and(eq(peoplePersons.id, keep.id), eq(peoplePersons.userId, userId)));
    await derivePersons(tx, userId, [keep.id]);
    return personSummary(tx, userId, keep.id);
  });
}

/**
 * 回答を新しい人に分ける（その回答のLINE名・本名で人を作り、回答を移す。R15）。メモ・手直しの同意は元の人に残す。
 * 元の人に回答が1つしかなければ 400 VALIDATION_FAILED。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param responseId - 回答
 * @returns 新しい人
 */
export async function splitResponse(env: Env, userId: string, responseId: string): Promise<PersonSummary> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const r = await loadOwnedResponse(tx, userId, responseId);
    const [n] = await tx.select({ n: count() }).from(peopleResponses).where(and(eq(peopleResponses.personId, r.personId), eq(peopleResponses.userId, userId)));
    if ((n?.n ?? 0) < 2) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["responseId"]);
    const [fresh] = await tx
      .insert(peoplePersons)
      .values({ userId, realName: r.realName, realNameKey: r.realNameKey, lineName: r.lineName, lineNameKey: r.lineNameKey, createdByImportId: r.importId })
      .returning({ id: peoplePersons.id });
    await tx.update(peopleResponses).set({ personId: fresh!.id }).where(and(eq(peopleResponses.id, r.id), eq(peopleResponses.userId, userId)));
    await derivePersons(tx, userId, [r.personId, fresh!.id]);
    return personSummary(tx, userId, fresh!.id);
  });
}

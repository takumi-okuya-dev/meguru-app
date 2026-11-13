// 手で人を足す・会ったイベントを足す／外す（specs/people/001-people-memo contracts/api.md 4、FR-014、tasks.md T060）。
import { nameKey, type PersonSummary } from "@meguru/shared/people";
import { and, eq } from "drizzle-orm";
import { createDb, withTransaction } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError, itemNotFound } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent, loadOwnedPerson, lockActiveOwner, lockOwner } from "../access";
import { peopleManualAttendances, peoplePersons, peopleResponses } from "../schema";
import { reportPeopleUsage } from "../usage";
import { derivePersons, recordManualConsent } from "./person-derive";
import { personSummary } from "./person-service";

/**
 * 人を手で足す。同意は手直しの事実として記録し（R11）、eventId があれば会ったイベントとして足す。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param input - 本名・LINE名（どちらかは必須）・会ったイベント・同意
 * @returns 足した人
 */
export async function createPerson(
  env: Env,
  userId: string,
  input: { realName?: string; lineName?: string; eventId?: string; consent: { invite: boolean; work: boolean } },
): Promise<PersonSummary> {
  const person = await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockActiveOwner(tx, env, userId);
    if (input.eventId) await loadOwnedEvent(tx, userId, input.eventId);
    const lineName = input.lineName ?? null;
    const [row] = await tx
      .insert(peoplePersons)
      .values({
        userId,
        realName: input.realName ?? null,
        realNameKey: input.realName ? nameKey(input.realName) : null,
        lineName,
        lineNameKey: lineName ? nameKey(lineName) : null,
        enteredLineName: lineName,
        enteredLineNameKey: lineName ? nameKey(lineName) : null,
      })
      .returning({ id: peoplePersons.id });
    const id = row!.id;
    if (input.eventId) await tx.insert(peopleManualAttendances).values({ personId: id, eventId: input.eventId, userId });
    await recordManualConsent(tx, userId, id, input.consent);
    await derivePersons(tx, userId, [id]);
    return personSummary(tx, userId, id);
  });
  await reportPeopleUsage(createDb(env.DATABASE_URL), userId);
  return person;
}

/**
 * 会ったイベントを足す（もうあれば何もしない）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param eventId - イベント
 * @returns 人
 */
export async function addAttendance(env: Env, userId: string, personId: string, eventId: string): Promise<PersonSummary> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    await loadOwnedEvent(tx, userId, eventId);
    await tx.insert(peopleManualAttendances).values({ personId: p.id, eventId, userId }).onConflictDoNothing();
    return personSummary(tx, userId, p.id);
  });
}

/**
 * 手で足した会ったイベントを外す。回答による来た記録は外せない（400 VALIDATION_FAILED）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param eventId - イベント
 */
export async function removeAttendance(env: Env, userId: string, personId: string, eventId: string): Promise<void> {
  if (!isUuid(eventId)) throw itemNotFound();
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    const removed = await tx
      .delete(peopleManualAttendances)
      .where(and(eq(peopleManualAttendances.personId, p.id), eq(peopleManualAttendances.eventId, eventId), eq(peopleManualAttendances.userId, userId)))
      .returning({ eventId: peopleManualAttendances.eventId });
    if (removed.length > 0) return;
    const [byResponse] = await tx
      .select({ id: peopleResponses.id })
      .from(peopleResponses)
      .where(and(eq(peopleResponses.personId, p.id), eq(peopleResponses.eventId, eventId)))
      .limit(1);
    if (byResponse) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["eventId"]);
    throw itemNotFound();
  });
}

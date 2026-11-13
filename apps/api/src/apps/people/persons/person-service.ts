// 人のページ・直す・同意を直す（specs/people/001-people-memo contracts/api.md 4、research.md R10・R11、tasks.md T053）。
import { nameKey, type PersonConsent, type PersonDetail, type PersonResponse, type PersonSummary } from "@meguru/shared/people";
import { and, desc, eq, sql } from "drizzle-orm";
import { withTransaction, type Db } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError } from "../../../kernel/errors";
import { displayNameOf, loadOwnedPerson, lockOwner, type PeopleDb } from "../access";
import { peopleConsentChanges, peopleEvents, peopleManualAttendances, peoplePersons, peopleResponses } from "../schema";
import { derivePersons, newerResponse, recordManualConsent } from "./person-derive";
import { personStatsSql } from "./person-query";

/**
 * 回答を、人のページの形にする。
 * @param r - 回答の行
 * @returns 人のページの回答
 */
function toResponse(r: typeof peopleResponses.$inferSelect): PersonResponse {
  return {
    id: r.id,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    lineName: r.lineName,
    realName: r.realName,
    nextAttendance: r.nextAttendance,
    bringFriends: r.bringFriends,
    wantedConnections: r.wantedConnections,
    careerInterests: r.careerInterests,
    consentChoices: r.consentChoices,
    answers: r.answers,
  };
}

/**
 * 人のページを読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - 作り手
 * @param personId - 人
 * @returns 人のページ（ない・ほかの作り手の人なら 404）
 */
export async function personDetail(db: PeopleDb, userId: string, personId: string): Promise<PersonDetail> {
  const p = await loadOwnedPerson(db, userId, personId);
  const [responses, manuals, changes] = await Promise.all([
    db
      .select({ r: peopleResponses, event: peopleEvents })
      .from(peopleResponses)
      .innerJoin(peopleEvents, eq(peopleEvents.id, peopleResponses.eventId))
      .where(and(eq(peopleResponses.personId, p.id), eq(peopleResponses.userId, userId))),
    db
      .select({ event: peopleEvents })
      .from(peopleManualAttendances)
      .innerJoin(peopleEvents, eq(peopleEvents.id, peopleManualAttendances.eventId))
      .where(and(eq(peopleManualAttendances.personId, p.id), eq(peopleManualAttendances.userId, userId))),
    db
      .select()
      .from(peopleConsentChanges)
      .where(and(eq(peopleConsentChanges.personId, p.id), eq(peopleConsentChanges.userId, userId)))
      .orderBy(desc(peopleConsentChanges.changedAt)),
  ]);

  const key = (x: (typeof responses)[number]) => ({ id: x.r.id, heldOn: x.event.heldOn, submittedAt: x.r.submittedAt, createdAt: x.r.createdAt });
  const sorted = [...responses].sort((a, b) => (newerResponse(key(a), key(b)) ? -1 : 1)).map((x) => ({ r: x.r, event: x.event }));
  // 来たイベント（新しい順）。回答があれば response、手で足しただけなら manual
  const byEvent = new Map<string, PersonDetail["attendances"][number]>();
  for (const x of sorted) {
    const a = byEvent.get(x.event.id) ?? { event: { id: x.event.id, name: x.event.name, heldOn: x.event.heldOn, isOwn: x.event.isOwn }, via: "response" as const, responses: [] };
    a.responses.push(toResponse(x.r));
    byEvent.set(x.event.id, a);
  }
  for (const m of manuals) {
    if (!byEvent.has(m.event.id)) byEvent.set(m.event.id, { event: { id: m.event.id, name: m.event.name, heldOn: m.event.heldOn, isOwn: m.event.isOwn }, via: "manual", responses: [] });
  }
  const attendances = [...byEvent.values()].sort((a, b) => (a.event.heldOn === b.event.heldOn ? a.event.name.localeCompare(b.event.name, "ja") : a.event.heldOn < b.event.heldOn ? 1 : -1));

  return {
    person: toSummary(p, otherLineNamesOf(p, sorted.map((x) => x.r.lineName)), attendances[0]?.event.heldOn ?? null),
    attendances,
    consentChanges: changes.map((c) => ({
      invite: c.invite,
      work: c.work,
      source: c.source as "response" | "manual",
      basisOn: c.basisOn,
      changedAt: c.changedAt.toISOString(),
    })),
    outreaches: [],
  };
}

/**
 * 人の行を、人のページの頭の形にする。
 * @param p - 人の行
 * @param otherLineNames - 別名
 * @param lastMetOn - 最後に会った日
 * @returns 人
 */
function toSummary(p: typeof peoplePersons.$inferSelect, otherLineNames: string[], lastMetOn: string | null): PersonSummary {
  return {
    id: p.id,
    displayName: displayNameOf(p),
    realName: p.realName,
    lineName: p.lineName,
    otherLineNames,
    memoAppearance: p.memoAppearance,
    memoTalk: p.memoTalk,
    consent: consentOf(p),
    lastMetOn,
  };
}

/**
 * 人の今の同意。
 * @param p - 人の行
 * @returns 同意
 */
function consentOf(p: typeof peoplePersons.$inferSelect): PersonConsent {
  return { invite: p.consentInvite, work: p.consentWork, source: p.consentSource as PersonConsent["source"], basisOn: p.consentBasisOn };
}

/**
 * 人の頭だけを読む（足す・まとめる・分けるの返り）。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人
 * @returns 人
 */
export async function personSummary(db: PeopleDb, userId: string, personId: string): Promise<PersonSummary> {
  const p = await loadOwnedPerson(db, userId, personId);
  // 頭に要るのは、別名（回答のLINE名）と最後に会った日だけ（回答の答えや同意の記録は読まない）
  const [lines, stats] = await Promise.all([
    db
      .select({ id: peopleResponses.id, lineName: peopleResponses.lineName, heldOn: peopleEvents.heldOn, submittedAt: peopleResponses.submittedAt, createdAt: peopleResponses.createdAt })
      .from(peopleResponses)
      .innerJoin(peopleEvents, eq(peopleEvents.id, peopleResponses.eventId))
      .where(and(eq(peopleResponses.personId, p.id), eq(peopleResponses.userId, userId))),
    db.execute<{ last_met_on: string | null }>(sql`SELECT s.last_met_on FROM (${personStatsSql(userId)}) s WHERE s.person_id = ${p.id}`),
  ]);
  const sorted = [...lines].sort((a, b) => (newerResponse(a, b) ? -1 : 1));
  return toSummary(p, otherLineNamesOf(p, sorted.map((l) => l.lineName)), stats.rows[0]?.last_met_on ?? null);
}

/**
 * 別名（今のLINE名のほかの、回答のLINE名（新しい順）と手で足したときのLINE名。R10）。
 * @param p - 人の行
 * @param responseLineNames - 回答のLINE名（新しい順）
 * @returns 別名
 */
function otherLineNamesOf(p: typeof peoplePersons.$inferSelect, responseLineNames: string[]): string[] {
  const others: string[] = [];
  for (const name of [...responseLineNames, p.enteredLineName]) {
    if (name && name !== p.lineName && !others.includes(name)) others.push(name);
  }
  return others;
}

/**
 * 本名・メモを直す（FR-015）。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人
 * @param input - 直す項目（メモの空は null にしてある）
 * @returns 人
 */
export async function updatePerson(
  db: Db,
  userId: string,
  personId: string,
  input: { realName?: string | null; memoAppearance?: string | null; memoTalk?: string | null },
): Promise<PersonSummary> {
  const p = await loadOwnedPerson(db, userId, personId);
  // 名前が1つもなくなる直し（LINE名のない人の本名を消す）はできない
  if (input.realName === null && p.lineName === null) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["realName"]);
  const set: Partial<typeof peoplePersons.$inferInsert> = { updatedAt: new Date() };
  if (input.realName !== undefined) {
    set.realName = input.realName;
    set.realNameKey = input.realName === null ? null : nameKey(input.realName);
  }
  if (input.memoAppearance !== undefined) set.memoAppearance = input.memoAppearance;
  if (input.memoTalk !== undefined) set.memoTalk = input.memoTalk;
  await db
    .update(peoplePersons)
    .set(set)
    .where(and(eq(peoplePersons.id, p.id), eq(peoplePersons.userId, userId)));
  return personSummary(db, userId, p.id);
}

/**
 * 同意を手で直す（手直しの事実を記録し、決め直す。R11）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param consent - 直したあとの同意
 * @returns 決め直したあとの同意
 */
export async function updateConsent(env: Env, userId: string, personId: string, consent: { invite: boolean; work: boolean }): Promise<PersonConsent> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    await recordManualConsent(tx, userId, p.id, consent);
    await derivePersons(tx, userId, [p.id]);
    const [fresh] = await tx
      .select()
      .from(peoplePersons)
      .where(and(eq(peoplePersons.id, p.id), eq(peoplePersons.userId, userId)));
    return consentOf(fresh!);
  });
}

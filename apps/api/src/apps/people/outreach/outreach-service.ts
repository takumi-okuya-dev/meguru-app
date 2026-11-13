// 声かけと進み具合（specs/people/001-people-memo contracts/api.md 5、research.md R16、tasks.md T077・T079）。
// 同じ声かけは1つ（交流会への誘いは人と誘う会、仕事のつなぎは人と相談先）。その目的の同意がない人には始めない（FR-018）。
// 相手の情報を外へ送る道は作らない（FR-023・FR-024）。声かけの行の user_id（作り手）が、判断した人（R16）。
import { nameKey, OUTREACH_STAGES, type Outreach, type OutreachCreateInput, type OutreachPurpose, type OutreachStage } from "@meguru/shared/people";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError, itemNotFound } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent, loadOwnedPerson, lockActiveOwner, lockOwner, type PeopleDb } from "../access";
import { attendanceSql } from "../persons/person-query";
import { peopleEvents, peopleOutreaches } from "../schema";

/** 進み具合ごとの日時の列。 */
const STAGE_AT = { link_sent: "linkSentAt", attended: "attendedAt", approved: "approvedAt", connected: "connectedAt" } as const;

/** 声かけの行と誘う会。 */
type Row = { o: typeof peopleOutreaches.$inferSelect; event: typeof peopleEvents.$inferSelect | null };

/**
 * 声かけを返りの形にする。
 * @param r - 声かけの行と誘う会
 * @returns 声かけ
 */
function toOutreach(r: Row): Outreach {
  return {
    id: r.o.id,
    personId: r.o.personId,
    purpose: r.o.purpose as OutreachPurpose,
    event: r.event ? { id: r.event.id, name: r.event.name, heldOn: r.event.heldOn } : null,
    targetName: r.o.targetName,
    stage: r.o.stage as OutreachStage,
    askedAt: r.o.askedAt.toISOString(),
    linkSentAt: r.o.linkSentAt?.toISOString() ?? null,
    attendedAt: r.o.attendedAt?.toISOString() ?? null,
    approvedAt: r.o.approvedAt?.toISOString() ?? null,
    connectedAt: r.o.connectedAt?.toISOString() ?? null,
  };
}

/**
 * 声かけを読む（誘う会つき）。
 * @param db - データベース
 * @param userId - 作り手
 * @param where - 条件
 * @returns 声かけ
 */
async function selectOutreaches(db: PeopleDb, userId: string, where: ReturnType<typeof and>): Promise<Outreach[]> {
  const rows = await db
    .select({ o: peopleOutreaches, event: peopleEvents })
    .from(peopleOutreaches)
    .leftJoin(peopleEvents, eq(peopleEvents.id, peopleOutreaches.eventId))
    .where(and(eq(peopleOutreaches.userId, userId), where))
    .orderBy(desc(peopleOutreaches.askedAt), desc(peopleOutreaches.id));
  return rows.map(toOutreach);
}

/**
 * 人の声かけ（新しく始めた順）。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人
 * @returns 声かけ
 */
export async function outreachesOfPerson(db: PeopleDb, userId: string, personId: string): Promise<Outreach[]> {
  return selectOutreaches(db, userId, eq(peopleOutreaches.personId, personId));
}

/**
 * 誘う会への声かけを、人ごとに読む（誘う候補の行に入れる）。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - 誘う会
 * @param personIds - 人
 * @returns 人の番号 → 声かけ
 */
export async function inviteOutreachesFor(db: PeopleDb, userId: string, eventId: string, personIds: readonly string[]): Promise<Map<string, Outreach>> {
  if (personIds.length === 0) return new Map();
  const list = await selectOutreaches(
    db,
    userId,
    and(eq(peopleOutreaches.purpose, "invite"), eq(peopleOutreaches.eventId, eventId), inArray(peopleOutreaches.personId, [...personIds])),
  );
  return new Map(list.map((o) => [o.personId, o]));
}

/**
 * 声かけを始める。交流会への誘いは人と誘う会（自分の会だけ）、仕事のつなぎは人と相談先（nameKey で同じなら同じ相談先）。
 * 同じ声かけがあれば今のものを返す（created: false）。その目的の同意がなければ 409 OUTREACH_NO_CONSENT（FR-018）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param input - 人と、誘う会か相談先
 * @returns 声かけと、新しく作ったか
 */
export async function createOutreach(env: Env, userId: string, input: OutreachCreateInput): Promise<{ outreach: Outreach; created: boolean }> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 行を作る書き込みなので、退会の途中でないことをロックの中で確かめる
    await lockActiveOwner(tx, env, userId);
    const p = await loadOwnedPerson(tx, userId, input.personId);
    let same;
    let values: typeof peopleOutreaches.$inferInsert;
    const now = new Date();
    if (input.purpose === "invite") {
      const event = await loadOwnedEvent(tx, userId, input.eventId);
      // 誘えるのは自分の会だけ（よその会には誘わない）
      if (!event.isOwn) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["eventId"]);
      same = and(eq(peopleOutreaches.personId, p.id), eq(peopleOutreaches.purpose, "invite"), eq(peopleOutreaches.eventId, input.eventId));
      values = { userId, personId: p.id, purpose: "invite", eventId: input.eventId, stage: "asked", askedAt: now };
    } else {
      const targetKey = nameKey(input.targetName);
      same = and(eq(peopleOutreaches.personId, p.id), eq(peopleOutreaches.purpose, "work"), eq(peopleOutreaches.targetKey, targetKey));
      values = { userId, personId: p.id, purpose: "work", targetName: input.targetName, targetKey, stage: "asked", askedAt: now };
    }
    const [existing] = await selectOutreaches(tx, userId, same);
    if (existing) return { outreach: existing, created: false };
    const consented = input.purpose === "invite" ? p.consentInvite : p.consentWork;
    if (!consented) throw new AppError("OUTREACH_NO_CONSENT", 409, "outreach without consent");
    await tx.insert(peopleOutreaches).values(values);
    const [created] = await selectOutreaches(tx, userId, same);
    return { outreach: created!, created: true };
  });
}

/**
 * 人ごとの最新の仕事のつなぎの声かけ（誘う候補の行に入れる）。
 * @param db - データベース
 * @param userId - 作り手
 * @param personIds - 人
 * @returns 人の番号 → 声かけ
 */
export async function latestWorkOutreachesFor(db: PeopleDb, userId: string, personIds: readonly string[]): Promise<Map<string, Outreach>> {
  if (personIds.length === 0) return new Map();
  // 人ごとに1件だけ読む（始めた時刻 → 番号の新しい順。同じ時刻でも決まる）
  const rows = await db
    .selectDistinctOn([peopleOutreaches.personId], { o: peopleOutreaches })
    .from(peopleOutreaches)
    .where(and(eq(peopleOutreaches.userId, userId), eq(peopleOutreaches.purpose, "work"), inArray(peopleOutreaches.personId, [...personIds])))
    .orderBy(peopleOutreaches.personId, desc(peopleOutreaches.askedAt), desc(peopleOutreaches.id));
  return new Map(rows.map((r) => [r.o.personId, toOutreach({ o: r.o, event: null })]));
}

/**
 * 声かけを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param outreachId - 声かけ
 * @returns 声かけの行
 */
async function loadOwnedOutreach(db: PeopleDb, userId: string, outreachId: string) {
  if (!isUuid(outreachId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(peopleOutreaches)
    .where(and(eq(peopleOutreaches.id, outreachId), eq(peopleOutreaches.userId, userId)));
  if (!row) throw itemNotFound();
  return row;
}

/**
 * 進み具合を変える（同じ目的の進み具合ならどれにでも。戻したら、それより先の日時を空にする。R16）。
 * 仕事のつなぎで、本人のOKの前に「つないだ」にしようとしたら 409 OUTREACH_NEEDS_APPROVAL（FR-023）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param outreachId - 声かけ
 * @param stage - 進み具合
 * @returns 声かけ
 */
export async function updateOutreachStage(env: Env, userId: string, outreachId: string, stage: OutreachStage): Promise<Outreach> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const o = await loadOwnedOutreach(tx, userId, outreachId);
    const stages: readonly string[] = OUTREACH_STAGES[o.purpose as OutreachPurpose];
    const to = stages.indexOf(stage);
    if (to < 0) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["stage"]);
    if (stage === "connected" && !o.approvedAt) throw new AppError("OUTREACH_NEEDS_APPROVAL", 409, "outreach needs approval");
    const now = new Date();
    const set: Partial<typeof peopleOutreaches.$inferInsert> = { stage, updatedAt: now };
    stages.forEach((s, i) => {
      if (s === "asked") return;
      const col = STAGE_AT[s as keyof typeof STAGE_AT];
      // ここまでの段は、まだ日時がなければ今にする。先の段の日時は空にする
      if (i <= to) set[col] = o[col] ?? now;
      else set[col] = null;
    });
    await tx.update(peopleOutreaches).set(set).where(and(eq(peopleOutreaches.id, o.id), eq(peopleOutreaches.userId, userId)));
    const [fresh] = await selectOutreaches(tx, userId, eq(peopleOutreaches.id, o.id));
    return fresh!;
  });
}

/**
 * 声かけを消す（押し間違い）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param outreachId - 声かけ
 */
export async function deleteOutreach(env: Env, userId: string, outreachId: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const o = await loadOwnedOutreach(tx, userId, outreachId);
    await tx.delete(peopleOutreaches).where(and(eq(peopleOutreaches.id, o.id), eq(peopleOutreaches.userId, userId)));
  });
}

/**
 * 誘った会に来た人の声かけを「来た」にする（取り込み・まとめる・会ったイベントを足すのトランザクションの最後で呼ぶ。FR-022）。
 * もう「来た」の声かけは変えない。
 * @param tx - トランザクション（作り手のロックを取ったもの）
 * @param userId - 作り手
 * @param pairs - 人と、来たイベント
 */
export async function markInviteAttended(tx: TxDb, userId: string, pairs: readonly { personId: string; eventId: string }[]): Promise<void> {
  if (pairs.length === 0) return;
  const now = new Date();
  const values = sql.join(
    pairs.map((p) => sql`(${p.personId}::uuid, ${p.eventId}::uuid)`),
    sql`, `,
  );
  await tx.execute(sql`UPDATE ${peopleOutreaches} AS o SET stage = 'attended',
      link_sent_at = coalesce(o.link_sent_at, ${now}), attended_at = ${now}, updated_at = ${now}
    FROM (VALUES ${values}) AS v(person_id, event_id)
    WHERE o.user_id = ${userId} AND o.purpose = 'invite' AND o.person_id = v.person_id AND o.event_id = v.event_id AND o.stage <> 'attended'`);
}

/**
 * 来た記録がなくなった誘いの声かけを「来た」から戻す（会ったイベントを外す・取り込みの取り消し・分けるのあとで呼ぶ）。
 * 自動で「来た」にしたものと同じく、戻したら「参加リンクを送った」にする（その日時は残す）。
 * @param tx - トランザクション（作り手のロックを取ったもの）
 * @param userId - 作り手
 * @param personIds - 来た記録が動いた人
 */
export async function resetInviteAttended(tx: TxDb, userId: string, personIds: readonly string[]): Promise<void> {
  if (personIds.length === 0) return;
  await tx.execute(sql`UPDATE ${peopleOutreaches} AS o SET stage = 'link_sent', attended_at = NULL, updated_at = now()
    WHERE o.user_id = ${userId} AND o.purpose = 'invite' AND o.stage = 'attended' AND ${inArray(sql`o.person_id`, [...personIds])}
      AND NOT EXISTS (SELECT 1 FROM (${attendanceSql(userId)}) a WHERE a.person_id = o.person_id AND a.event_id = o.event_id)`);
}

/**
 * まとめるとき、相手の声かけを残す人へ移す。同じ声かけが両方にあれば、進み具合の先の方を残す（R15）。
 * @param tx - トランザクション（作り手のロックを取ったもの）
 * @param userId - 作り手
 * @param keepId - 残す人
 * @param otherId - 相手
 */
export async function mergeOutreaches(tx: TxDb, userId: string, keepId: string, otherId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(peopleOutreaches)
    .where(and(eq(peopleOutreaches.userId, userId), inArray(peopleOutreaches.personId, [keepId, otherId])));
  const sameKey = (o: typeof peopleOutreaches.$inferSelect) => `${o.purpose}|${o.eventId ?? ""}|${o.targetKey ?? ""}`;
  const rank = (o: typeof peopleOutreaches.$inferSelect) => (OUTREACH_STAGES[o.purpose as OutreachPurpose] as readonly string[]).indexOf(o.stage);
  const keepByKey = new Map(rows.filter((o) => o.personId === keepId).map((o) => [sameKey(o), o]));
  for (const o of rows.filter((x) => x.personId === otherId)) {
    const mine = keepByKey.get(sameKey(o));
    if (mine && rank(mine) >= rank(o)) {
      await tx.delete(peopleOutreaches).where(eq(peopleOutreaches.id, o.id));
      continue;
    }
    if (mine) await tx.delete(peopleOutreaches).where(eq(peopleOutreaches.id, mine.id));
    await tx.update(peopleOutreaches).set({ personId: keepId, updatedAt: new Date() }).where(eq(peopleOutreaches.id, o.id));
  }
}

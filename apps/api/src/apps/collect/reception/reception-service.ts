// 受付（specs/collect/001-event-day-collection contracts/api.md 4・8、FR-030〜FR-039、data-model.md 2-4・4、
// research.md R6・R17、tasks.md T036・T049）。
// - 記録は名簿の人1人に1行（主キー）。INSERT … ON CONFLICT DO NOTHING RETURNING で、返らなければ先の記録で 409 ALREADY_RECORDED。
// - 同じ clientRequestId の送り直しは、前と同じ結果を返す（通信が途切れても二重にしない）。
// - 区分と金額は記録にだけ持ち、名簿の区分は変えない（R17。手伝う人は名簿を直せないため）。
// - 受付の画面に関わる変更のたびに events.version を1上げ、新しい version を返す（会場の共有の知らせは呼ぶ側が送る）。
// どの書き込みも、はじめにイベントの行をロックする（同じイベントの記録は1つずつ進む。数十〜数百人の受付なら待ちは短い）。
import {
  isReceptionMethodAllowed,
  nameKey,
  type CollectMedia,
  type ReceptionHelper,
  type ReceptionMethod,
  type ReceptionPerson,
  type ReceptionRecord,
  type ReceptionSnapshot,
  type ReceptionStats,
  type RecordReceptionRequest,
  type WalkInRequest,
} from "@meguru/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadActorEvent, type CollectEventRow, type ReceptionActor } from "../access";
import {
  collectHelpers,
  collectOwnerSettings,
  collectPriceTiers,
  collectReceptionRecords,
  collectRosterPeople,
  collectEvents,
} from "../schema";

type RecordRow = typeof collectReceptionRecords.$inferSelect;
type PersonRow = typeof collectRosterPeople.$inferSelect;

/**
 * 受付の記録の行を応答の形にする。
 * @param row - reception_records の行
 * @returns 受付の記録
 */
export function toRecord(row: RecordRow): ReceptionRecord {
  return {
    personId: row.rosterPersonId,
    method: row.method as ReceptionMethod,
    priceTierId: row.priceTierId,
    amount: row.amount,
    amountOverridden: row.amountOverridden,
    receiverKind: row.receiverKind as ReceptionRecord["receiverKind"],
    receiverHelperId: row.receiverHelperId,
    paymentStatus: row.paymentStatus as ReceptionRecord["paymentStatus"],
    transferConfirmedAt: row.transferConfirmedAt?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
  };
}

/**
 * 名簿の人の行を受付の画面の形にする。メモは主催者にだけ渡す（手伝う人の画面と会場の共有の知らせには入れない。FR-002）。
 * @param row - roster_people の行
 * @param withMemo - メモを入れるか
 * @returns 受付の画面の名簿の人
 */
export function toReceptionPerson(row: PersonRow, withMemo: boolean): ReceptionPerson {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    kana: row.kana,
    media: row.media as CollectMedia,
    priceTierId: row.priceTierId,
    ...(withMemo ? { memo: row.memo } : {}),
  };
}

/**
 * ない・ほかのイベントの名簿の人。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
const personNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "person not found");

/**
 * 受け取った人の列の値。
 * @param actor - 受付をする人
 * @returns receiver_kind と receiver_helper_id
 */
function receiverOf(actor: ReceptionActor): { receiverKind: "owner" | "helper"; receiverHelperId: string | null } {
  return actor.kind === "owner" ? { receiverKind: "owner", receiverHelperId: null } : { receiverKind: "helper", receiverHelperId: actor.helperId };
}

/**
 * 版を1上げる。
 * @param tx - トランザクション（イベントの行はロック済み）
 * @param eventId - イベントの番号
 * @returns 新しい版
 */
async function bumpVersion(tx: TxDb, eventId: string): Promise<number> {
  const [row] = await tx
    .update(collectEvents)
    .set({ version: sql`${collectEvents.version} + 1`, updatedAt: new Date() })
    .where(eq(collectEvents.id, eventId))
    .returning({ version: collectEvents.version });
  return row!.version;
}

/**
 * 受付を記録する（FR-031・FR-032・FR-035）。
 * @param databaseUrl - 接続文字列
 * @param actor - 受付をする人（受け取った人になる）
 * @param eventId - イベントの番号
 * @param personId - 名簿の人の番号
 * @param input - 検証済みの入力
 * @returns 記録と新しい版。replayed は同じ clientRequestId の送り直しだったとき（版は上げず、知らせも送らない）
 * @throws AppError ITEM_NOT_FOUND・VALIDATION_FAILED（使わない払い方・ほかのイベントの区分）・ALREADY_RECORDED（record に先の記録）
 */
export async function recordReception(
  databaseUrl: string,
  actor: ReceptionActor,
  eventId: string,
  personId: string,
  input: RecordReceptionRequest,
): Promise<{ record: ReceptionRecord; version: number; replayed: boolean }> {
  if (!isUuid(personId)) throw personNotFound();
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadActorEvent(tx, actor, eventId, { forUpdate: true });
    // 送り直し：同じ clientRequestId の記録があれば、前と同じ結果を返す（R6）
    const [replay] = await tx.select().from(collectReceptionRecords).where(eq(collectReceptionRecords.clientRequestId, input.clientRequestId)).limit(1);
    if (replay) {
      if (replay.rosterPersonId !== personId || replay.eventId !== event.id) {
        throw new AppError("VALIDATION_FAILED", 400, "clientRequestId already used", undefined, ["clientRequestId"]);
      }
      return { record: toRecord(replay), version: event.version, replayed: true };
    }
    const [person] = await tx
      .select({ id: collectRosterPeople.id, priceTierId: collectRosterPeople.priceTierId })
      .from(collectRosterPeople)
      .where(and(eq(collectRosterPeople.id, personId), eq(collectRosterPeople.eventId, event.id)))
      .limit(1);
    if (!person) throw personNotFound();
    if (!isReceptionMethodAllowed(input.method, event.methods)) {
      throw new AppError("VALIDATION_FAILED", 400, "method not used in this event", undefined, ["method"]);
    }
    const tierId = input.priceTierId ?? person.priceTierId;
    const [tier] = await tx
      .select({ id: collectPriceTiers.id, amount: collectPriceTiers.amount })
      .from(collectPriceTiers)
      .where(and(eq(collectPriceTiers.id, tierId), eq(collectPriceTiers.eventId, event.id)))
      .limit(1);
    if (!tier) throw new AppError("VALIDATION_FAILED", 400, "unknown tier", undefined, ["priceTierId"]);
    // 来場のみは0円。金額を直接入れたら、区分の金額と違うときだけ「直接変えた」にする（FR-032）
    const amount = input.method === "none" ? 0 : (input.amount ?? tier.amount);
    const transfer = input.method === "transfer_today" || input.method === "transfer_later";
    const [row] = await tx
      .insert(collectReceptionRecords)
      .values({
        rosterPersonId: person.id,
        eventId: event.id,
        method: input.method,
        priceTierId: tier.id,
        amount,
        amountOverridden: input.method !== "none" && amount !== tier.amount,
        ...receiverOf(actor),
        paymentStatus: transfer ? "awaiting_transfer" : "paid",
        clientRequestId: input.clientRequestId,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      // 先に記録した人がいる（イベントの行をロックしているので、ここで読めば必ずある）
      const [existing] = await tx.select().from(collectReceptionRecords).where(eq(collectReceptionRecords.rosterPersonId, person.id)).limit(1);
      throw new AppError("ALREADY_RECORDED", 409, "already recorded", undefined, undefined, { record: existing ? toRecord(existing) : null });
    }
    return { record: toRecord(row), version: await bumpVersion(tx, event.id), replayed: false };
  });
}

/**
 * 受付を取り消す（FR-039）。主催者はすべて、手伝う人は自分が受け取った記録だけ。
 * @param databaseUrl - 接続文字列
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @param personId - 名簿の人の番号
 * @returns 新しい版
 * @throws AppError ITEM_NOT_FOUND（記録がない）・RECORD_NOT_YOURS（手伝う人がほかの人の記録を取り消そうとした）
 */
export async function undoReception(databaseUrl: string, actor: ReceptionActor, eventId: string, personId: string): Promise<{ version: number }> {
  if (!isUuid(personId)) throw personNotFound();
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadActorEvent(tx, actor, eventId, { forUpdate: true });
    const [record] = await tx
      .select({ receiverHelperId: collectReceptionRecords.receiverHelperId })
      .from(collectReceptionRecords)
      .where(and(eq(collectReceptionRecords.rosterPersonId, personId), eq(collectReceptionRecords.eventId, event.id)))
      .limit(1);
    if (!record) throw personNotFound();
    if (actor.kind === "helper" && record.receiverHelperId !== actor.helperId) {
      throw new AppError("RECORD_NOT_YOURS", 403, "record received by someone else");
    }
    await tx.delete(collectReceptionRecords).where(eq(collectReceptionRecords.rosterPersonId, personId));
    return { version: await bumpVersion(tx, event.id) };
  });
}

/**
 * 飛び入りを足す（FR-034）。媒体は「当日」、区分は最初の区分。受付番号は名簿と同じく next_number から取る。
 * 同じ clientRequestId の送り直しは、前に足した人を返す。
 * @param databaseUrl - 接続文字列
 * @param actor - 受付をする人（手伝う人なら added_by_helper_id に入れる）
 * @param eventId - イベントの番号
 * @param input - 検証済みの入力
 * @returns 足した人（メモなし）と新しい版。replayed は送り直しだったとき
 */
export async function addWalkIn(
  databaseUrl: string,
  actor: ReceptionActor,
  eventId: string,
  input: WalkInRequest,
): Promise<{ person: ReceptionPerson; version: number; replayed: boolean }> {
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadActorEvent(tx, actor, eventId, { forUpdate: true });
    const [replay] = await tx.select().from(collectRosterPeople).where(eq(collectRosterPeople.clientRequestId, input.clientRequestId)).limit(1);
    if (replay) {
      if (replay.eventId !== event.id) throw new AppError("VALIDATION_FAILED", 400, "clientRequestId already used", undefined, ["clientRequestId"]);
      return { person: toReceptionPerson(replay, false), version: event.version, replayed: true };
    }
    const [tier] = await tx
      .select({ id: collectPriceTiers.id })
      .from(collectPriceTiers)
      .where(eq(collectPriceTiers.eventId, event.id))
      .orderBy(asc(collectPriceTiers.position))
      .limit(1);
    if (!tier) throw new AppError("VALIDATION_FAILED", 400, "event has no tier", undefined, ["priceTierId"]);
    const [numbered] = await tx
      .update(collectEvents)
      .set({ nextNumber: sql`${collectEvents.nextNumber} + 1`, version: sql`${collectEvents.version} + 1`, updatedAt: new Date() })
      .where(eq(collectEvents.id, event.id))
      .returning({ next: collectEvents.nextNumber, version: collectEvents.version });
    const [row] = await tx
      .insert(collectRosterPeople)
      .values({
        eventId: event.id,
        number: numbered!.next - 1,
        name: input.name,
        nameKey: nameKey(input.name),
        media: "walk_in",
        priceTierId: tier.id,
        addedByHelperId: actor.kind === "helper" ? actor.helperId : null,
        clientRequestId: input.clientRequestId,
      })
      .returning();
    return { person: toReceptionPerson(row!, false), version: numbered!.version, replayed: false };
  });
}

/**
 * 受付の画面の数字（data-model.md 4）。
 * @param rosterCount - 名簿の人数
 * @param records - 受付の記録
 * @param actor - 呼んだ人（mine の数え方）
 * @returns 数字
 */
export function computeStats(rosterCount: number, records: ReceptionRecord[], actor: ReceptionActor): ReceptionStats {
  const stats: ReceptionStats = { arrived: records.length, rosterCount, cash: 0, paypay: 0, awaitingTransferCount: 0, awaitingTransferAmount: 0, mine: 0 };
  for (const r of records) {
    if (r.method === "cash") {
      stats.cash += r.amount;
      const mine = actor.kind === "owner" ? r.receiverKind === "owner" : r.receiverHelperId === actor.helperId;
      if (mine) stats.mine += r.amount;
    }
    if (r.method === "paypay") stats.paypay += r.amount;
    if (r.paymentStatus === "awaiting_transfer") {
      stats.awaitingTransferCount += 1;
      stats.awaitingTransferAmount += r.amount;
    }
  }
  return stats;
}

/**
 * イベントの手伝う人（受け取った人の名前を出すため。入った順）。
 * @param db - データベース
 * @param eventId - イベントの番号
 * @returns 手伝う人
 */
export async function listReceptionHelpers(db: Db | TxDb, eventId: string): Promise<ReceptionHelper[]> {
  const rows = await db
    .select({ id: collectHelpers.id, name: collectHelpers.name, joinedAt: collectHelpers.joinedAt })
    .from(collectHelpers)
    .where(eq(collectHelpers.eventId, eventId))
    .orderBy(asc(collectHelpers.joinedAt));
  return rows.map((h) => ({ id: h.id, name: h.name, joinedAt: h.joinedAt.toISOString() }));
}

/**
 * 受付の全体（スナップショット。contracts/api.md 4・8）。手伝う人にはメモを返さない（FR-002）。
 * @param db - データベース
 * @param actor - 呼んだ人
 * @param eventId - イベントの番号
 * @returns スナップショット
 */
export async function receptionSnapshot(db: Db, actor: ReceptionActor, eventId: string): Promise<ReceptionSnapshot> {
  const event: CollectEventRow = await loadActorEvent(db, actor, eventId);
  const [tiers, people, recordRows, helpers, settingsRows] = await Promise.all([
    db.select().from(collectPriceTiers).where(eq(collectPriceTiers.eventId, event.id)).orderBy(asc(collectPriceTiers.position)),
    db.select().from(collectRosterPeople).where(eq(collectRosterPeople.eventId, event.id)).orderBy(asc(collectRosterPeople.number)),
    db.select().from(collectReceptionRecords).where(eq(collectReceptionRecords.eventId, event.id)),
    listReceptionHelpers(db, event.id),
    db
      .select({ hasPaypayQr: sql<boolean>`${collectOwnerSettings.paypayQr} IS NOT NULL`, bankText: collectOwnerSettings.bankText })
      .from(collectOwnerSettings)
      .where(eq(collectOwnerSettings.ownerUserId, event.ownerUserId))
      .limit(1),
  ]);
  const records = recordRows.map(toRecord);
  const byPerson = new Map(records.map((r) => [r.personId, r]));
  return {
    version: event.version,
    event: {
      id: event.id,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      venue: event.venue,
      methods: event.methods as ReceptionSnapshot["event"]["methods"],
      tiers: tiers.map((t) => ({ id: t.id, name: t.name, amount: t.amount, position: t.position })),
      closedAt: event.closedAt?.toISOString() ?? null,
    },
    people: people.map((p) => ({ person: toReceptionPerson(p, actor.kind === "owner"), record: byPerson.get(p.id) ?? null })),
    stats: computeStats(people.length, records, actor),
    helpers,
    settings: { hasPaypayQr: settingsRows[0]?.hasPaypayQr ?? false, bankText: settingsRows[0]?.bankText ?? null },
  };
}

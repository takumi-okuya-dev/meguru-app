// 振込待ち（specs/collect/001-event-day-collection contracts/api.md 7、FR-050・FR-051、tasks.md T065）。
// 主催者のすべてのイベントの振込待ちと、確かめた記録（新しい順・最大100件）。入金を確かめると支払い済みにして、確かめた日を残す。
// 振込の確かめは後日のことが多いので、受付の画面の版は上げない（締めのあとの「変わった」にしない。締めの画面は毎回数えるので反映される）。
import { nameKey, tierUndecidedFor, type TransferItem, type TransferList } from "@meguru/shared";
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { withTransaction, type Db } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { collectEvents, collectPriceTiers, collectReceptionRecords, collectRosterPeople } from "../schema";

const TRANSFER_METHODS = ["transfer_today", "transfer_later"];
const CONFIRMED_LIMIT = 100;

/**
 * 主催者の振込の記録を読む。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param where - 足す条件
 * @param order - 並び
 * @param limit - 件数の上限
 * @returns 振込の行
 */
async function selectTransfers(db: Db, ownerUserId: string, where: SQL, order: SQL[], limit?: number): Promise<TransferItem[]> {
  const q = db
    .select({
      personId: collectRosterPeople.id,
      eventId: collectEvents.id,
      eventName: collectEvents.name,
      eventStartsAt: collectEvents.startsAt,
      number: collectRosterPeople.number,
      name: collectRosterPeople.name,
      kana: collectRosterPeople.kana,
      amount: collectReceptionRecords.amount,
      method: collectReceptionRecords.method,
      recordedAt: collectReceptionRecords.recordedAt,
      transferConfirmedAt: collectReceptionRecords.transferConfirmedAt,
      tierUndecided: collectRosterPeople.tierUndecided,
    })
    .from(collectReceptionRecords)
    .innerJoin(collectRosterPeople, eq(collectRosterPeople.id, collectReceptionRecords.rosterPersonId))
    .innerJoin(collectEvents, eq(collectEvents.id, collectReceptionRecords.eventId))
    .where(and(eq(collectEvents.ownerUserId, ownerUserId), inArray(collectReceptionRecords.method, TRANSFER_METHODS), where))
    .orderBy(...order);
  const rows = await (limit ? q.limit(limit) : q);
  // 区分が決まっていない人には、区分を選ぶためにそのイベントの区分を付ける（specs/collect/004 research.md R3）
  const undecidedEvents = [...new Set(rows.filter((r) => r.tierUndecided).map((r) => r.eventId))];
  const tierRows =
    undecidedEvents.length === 0
      ? []
      : await db
          .select({ eventId: collectPriceTiers.eventId, id: collectPriceTiers.id, name: collectPriceTiers.name, amount: collectPriceTiers.amount })
          .from(collectPriceTiers)
          .where(inArray(collectPriceTiers.eventId, undecidedEvents))
          .orderBy(asc(collectPriceTiers.position));
  return rows.map((r) => ({
    ...r,
    eventStartsAt: r.eventStartsAt.toISOString(),
    method: r.method as TransferItem["method"],
    recordedAt: r.recordedAt.toISOString(),
    transferConfirmedAt: r.transferConfirmedAt?.toISOString() ?? null,
    tiers: r.tierUndecided ? tierRows.filter((t) => t.eventId === r.eventId).map(({ id, name, amount }) => ({ id, name, amount })) : [],
  }));
}

/**
 * 振込待ちと確かめた記録（GET /api/collect/transfers?q=）。受付番号（数字だけのとき）か名前・ふりがなで探す。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param q - 探す言葉
 * @returns 振込待ちと確かめた記録
 */
export async function listTransfers(db: Db, ownerUserId: string, q: string | undefined): Promise<TransferList> {
  const key = nameKey(q ?? "");
  const like = `%${key.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const search =
    key === ""
      ? sql`true`
      : /^\d+$/.test(key)
        ? sql`(${collectRosterPeople.number}::text LIKE ${`${key}%`} OR ${collectRosterPeople.nameKey} LIKE ${like})`
        : sql`(${collectRosterPeople.nameKey} LIKE ${like} OR ${collectRosterPeople.kanaKey} LIKE ${like})`;
  const [awaiting, confirmed] = await Promise.all([
    selectTransfers(db, ownerUserId, and(eq(collectReceptionRecords.paymentStatus, "awaiting_transfer"), search)!, [asc(collectReceptionRecords.recordedAt)]),
    selectTransfers(db, ownerUserId, and(isNotNull(collectReceptionRecords.transferConfirmedAt), search)!, [desc(collectReceptionRecords.transferConfirmedAt)], CONFIRMED_LIMIT),
  ]);
  return { awaiting, confirmed };
}

/**
 * 区分が決まっていない人の入金を確かめるとき、区分を決める（specs/collect/004 research.md R3）。
 * イベントの区分が2つ以上なら priceTierId が要る（なければ TIER_REQUIRED）。1つならその区分。
 * 記録の区分と金額・名簿の人の区分を変え、区分が決まったことにする。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param personId - 名簿の人の番号
 * @param priceTierId - 選んだ区分
 * @throws AppError TIER_REQUIRED・VALIDATION_FAILED（ほかのイベントの区分）
 */
async function decideTransferTier(databaseUrl: string, ownerUserId: string, personId: string, priceTierId: string | undefined): Promise<void> {
  await withTransaction(databaseUrl, async (tx) => {
    const [person] = await tx
      .select({ eventId: collectRosterPeople.eventId, tierUndecided: collectRosterPeople.tierUndecided })
      .from(collectRosterPeople)
      .innerJoin(collectEvents, eq(collectEvents.id, collectRosterPeople.eventId))
      .where(and(eq(collectRosterPeople.id, personId), eq(collectEvents.ownerUserId, ownerUserId)))
      .for("update");
    if (!person?.tierUndecided) return;
    // 振込の記録がなければ何もしない（あとの確かめで 404 にする）
    const [record] = await tx
      .select({ id: collectReceptionRecords.rosterPersonId })
      .from(collectReceptionRecords)
      .where(and(eq(collectReceptionRecords.rosterPersonId, personId), inArray(collectReceptionRecords.method, TRANSFER_METHODS)))
      .limit(1);
    if (!record) return;
    const tiers = await tx
      .select({ id: collectPriceTiers.id, amount: collectPriceTiers.amount, position: collectPriceTiers.position })
      .from(collectPriceTiers)
      .where(eq(collectPriceTiers.eventId, person.eventId))
      .orderBy(asc(collectPriceTiers.position));
    if (tierUndecidedFor(tiers) && !priceTierId) throw new AppError("TIER_REQUIRED", 400, "price tier required", undefined, ["priceTierId"]);
    const tier = priceTierId ? tiers.find((t) => t.id === priceTierId) : tiers[0];
    if (!tier) throw new AppError("VALIDATION_FAILED", 400, "unknown tier", undefined, ["priceTierId"]);
    await tx
      .update(collectReceptionRecords)
      .set({ priceTierId: tier.id, amount: tier.amount, amountOverridden: false })
      .where(and(eq(collectReceptionRecords.rosterPersonId, personId), inArray(collectReceptionRecords.method, TRANSFER_METHODS)));
    await tx.update(collectRosterPeople).set({ priceTierId: tier.id, tierUndecided: false }).where(eq(collectRosterPeople.id, personId));
  });
}

/**
 * 入金を確かめる・振込待ちに戻す（POST・DELETE /api/collect/transfers/:personId/confirm。FR-051）。
 * 区分が決まっていない人は、確かめるときに区分を決める（specs/collect/004 FR-022）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param personId - 名簿の人の番号
 * @param confirmed - 確かめたなら true、戻すなら false
 * @param decide - 区分を決めるときの接続文字列と選んだ区分（確かめるときだけ）
 * @returns 直した行
 * @throws AppError ITEM_NOT_FOUND（ない・ほかの主催者・振込でない）・TIER_REQUIRED
 */
export async function setTransferConfirmed(
  db: Db,
  ownerUserId: string,
  personId: string,
  confirmed: boolean,
  decide?: { databaseUrl: string; priceTierId?: string },
): Promise<TransferItem> {
  if (!isUuid(personId)) throw new AppError("ITEM_NOT_FOUND", 404, "transfer not found");
  if (confirmed && decide) await decideTransferTier(decide.databaseUrl, ownerUserId, personId, decide.priceTierId);
  const owned = db
    .select({ id: collectEvents.id })
    .from(collectEvents)
    .where(eq(collectEvents.ownerUserId, ownerUserId));
  const updated = await db
    .update(collectReceptionRecords)
    .set(confirmed ? { paymentStatus: "paid", transferConfirmedAt: new Date() } : { paymentStatus: "awaiting_transfer", transferConfirmedAt: null })
    .where(
      and(
        eq(collectReceptionRecords.rosterPersonId, personId),
        inArray(collectReceptionRecords.method, TRANSFER_METHODS),
        inArray(collectReceptionRecords.eventId, owned),
      ),
    )
    .returning({ personId: collectReceptionRecords.rosterPersonId });
  if (updated.length === 0) throw new AppError("ITEM_NOT_FOUND", 404, "transfer not found");
  const [item] = await selectTransfers(db, ownerUserId, eq(collectReceptionRecords.rosterPersonId, personId), []);
  return item!;
}

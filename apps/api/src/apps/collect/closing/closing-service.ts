// 締め（specs/collect/001-event-day-collection contracts/api.md 6、FR-040〜FR-045、data-model.md 2-7、tasks.md T058）。
// 締めの画面の数字は毎回数える。精算は受け取った人ごとに「渡された額」と「精算した」を持ち、精算したときの合計を残す。
// 締めると closed_at と closed_version（そのときの版）を残し、あとで版が上がったら「締めのあとで変わった」と出す。
// 精算・PayPayの確かめ・締めは受付の画面を変えないので、版は上げない。
import { type CashReceiver, type ClosingSnapshot, type CollectMedia, type PutSettlementRequest } from "@meguru/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { createDb, withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent, type CollectEventRow } from "../access";
import { collectEvents, collectHelpers, collectReceptionRecords, collectRosterPeople, collectSettlements } from "../schema";
import { tally } from "./tally";

/** 主催者の受け取った人の鍵。 */
const OWNER_KEY = "owner";

/**
 * イベントの名簿・記録・手伝う人・精算を読む。
 * @param db - データベース
 * @param event - イベント
 * @returns 読んだ行
 */
async function loadClosingRows(db: Db, event: CollectEventRow) {
  const [people, records, helpers, settlements] = await Promise.all([
    db.select().from(collectRosterPeople).where(eq(collectRosterPeople.eventId, event.id)).orderBy(asc(collectRosterPeople.number)),
    db.select().from(collectReceptionRecords).where(eq(collectReceptionRecords.eventId, event.id)),
    db.select({ id: collectHelpers.id, name: collectHelpers.name }).from(collectHelpers).where(eq(collectHelpers.eventId, event.id)).orderBy(asc(collectHelpers.joinedAt)),
    db.select().from(collectSettlements).where(eq(collectSettlements.eventId, event.id)),
  ]);
  return { people, records, helpers, settlements };
}

/**
 * 受け取った人ごとの現金（主催者はいつも出す。手伝う人は、現金を受け取ったか精算の行がある人だけ）。
 * @param rows - 読んだ行
 * @returns 精算の行
 */
function cashReceivers(rows: Awaited<ReturnType<typeof loadClosingRows>>): CashReceiver[] {
  const sums = new Map<string, { count: number; amount: number }>();
  for (const r of rows.records) {
    if (r.method !== "cash") continue;
    const key = r.receiverHelperId ?? OWNER_KEY;
    const s = sums.get(key) ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += r.amount;
    sums.set(key, s);
  }
  const settlement = new Map(rows.settlements.map((s) => [s.receiverKey, s]));
  const receivers = [{ key: OWNER_KEY, name: "主催者" }, ...rows.helpers.map((h) => ({ key: h.id, name: h.name }))];
  return receivers
    .filter((r) => r.key === OWNER_KEY || sums.has(r.key) || settlement.has(r.key))
    .map((r) => {
      const s = sums.get(r.key) ?? { count: 0, amount: 0 };
      const set = settlement.get(r.key);
      return {
        receiverKey: r.key,
        name: r.name,
        count: s.count,
        amount: s.amount,
        countedAmount: set?.countedAmount ?? null,
        settledAt: set?.settledAt?.toISOString() ?? null,
        changedAfterSettle: Boolean(set?.settledAt) && set?.expectedAtSettle !== s.amount,
      };
    });
}

/**
 * 締めの画面（GET …/closing）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns 締めの画面の数字
 */
export async function closingSnapshot(db: Db, ownerUserId: string, eventId: string): Promise<ClosingSnapshot> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const rows = await loadClosingRows(db, event);
  const t = tally(rows.people, rows.records);
  const personById = new Map(rows.people.map((p) => [p.id, p]));
  const helperName = new Map(rows.helpers.map((h) => [h.id, h.name]));
  const recorded = new Set(rows.records.map((r) => r.rosterPersonId));
  const paypay = rows.records
    .filter((r) => r.method === "paypay")
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    .map((r) => ({
      personId: r.rosterPersonId,
      number: personById.get(r.rosterPersonId)?.number ?? 0,
      name: personById.get(r.rosterPersonId)?.name ?? "",
      amount: r.amount,
      recordedAt: r.recordedAt.toISOString(),
      receiverName: r.receiverHelperId ? (helperName.get(r.receiverHelperId) ?? "手伝う人") : "主催者",
    }));
  return {
    version: event.version,
    event: { id: event.id, name: event.name, startsAt: event.startsAt.toISOString() },
    closedAt: event.closedAt?.toISOString() ?? null,
    changedAfterClose: event.closedAt !== null && event.closedVersion !== event.version,
    attendance: t.attendance,
    byMethod: t.byMethod,
    cashByReceiver: cashReceivers(rows),
    paypay: { count: t.byMethod.paypay.count, amount: t.byMethod.paypay.amount, checkedAt: event.paypayCheckedAt?.toISOString() ?? null, records: paypay },
    transfers: t.transfers,
    byMedia: t.byMedia,
    absent: rows.people
      .filter((p) => !recorded.has(p.id))
      .map((p) => ({ personId: p.id, number: p.number, name: p.name, kana: p.kana, media: p.media as CollectMedia })),
  };
}

/**
 * 受け取った人の鍵が、このイベントのものかを確かめる。
 * @param db - データベース
 * @param eventId - イベントの番号
 * @param receiverKey - "owner" か手伝う人の番号
 * @throws AppError ITEM_NOT_FOUND
 */
async function assertReceiver(db: Db | TxDb, eventId: string, receiverKey: string): Promise<void> {
  if (receiverKey === OWNER_KEY) return;
  const [helper] = isUuid(receiverKey)
    ? await db
        .select({ id: collectHelpers.id })
        .from(collectHelpers)
        .where(and(eq(collectHelpers.id, receiverKey), eq(collectHelpers.eventId, eventId)))
        .limit(1)
    : [];
  if (!helper) throw new AppError("ITEM_NOT_FOUND", 404, "receiver not found");
}

/**
 * 精算を入れる（PUT …/settlements/:receiverKey。FR-041）。「精算した」を押したら、そのときの合計を残す。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param receiverKey - "owner" か手伝う人の番号
 * @param input - 渡された額・精算したか
 * @returns 締めの画面の数字
 */
export async function putSettlement(
  databaseUrl: string,
  ownerUserId: string,
  eventId: string,
  receiverKey: string,
  input: PutSettlementRequest,
): Promise<ClosingSnapshot> {
  await withTransaction(databaseUrl, async (tx) => {
    // 精算の合計を数えるあいだに記録が変わらないよう、イベントの行をロックする
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    await assertReceiver(tx, event.id, receiverKey);
    const [sum] = await tx
      .select({ amount: sql<number>`coalesce(sum(${collectReceptionRecords.amount}), 0)`.mapWith(Number) })
      .from(collectReceptionRecords)
      .where(
        and(
          eq(collectReceptionRecords.eventId, event.id),
          eq(collectReceptionRecords.method, "cash"),
          receiverKey === OWNER_KEY ? eq(collectReceptionRecords.receiverKind, "owner") : eq(collectReceptionRecords.receiverHelperId, receiverKey),
        ),
      );
    const settled =
      input.settled === undefined ? {} : input.settled ? { settledAt: new Date(), expectedAtSettle: sum?.amount ?? 0 } : { settledAt: null, expectedAtSettle: null };
    const counted = input.countedAmount === undefined ? {} : { countedAmount: input.countedAmount };
    await tx
      .insert(collectSettlements)
      .values({ eventId: event.id, receiverKey, ...counted, ...settled })
      .onConflictDoUpdate({ target: [collectSettlements.eventId, collectSettlements.receiverKey], set: { ...counted, ...settled } });
  });
  return closingSnapshot(createDb(databaseUrl), ownerUserId, eventId);
}

/**
 * PayPay の「履歴と合った」（POST …/paypay-check。FR-042）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns 締めの画面の数字
 */
export async function checkPaypay(db: Db, ownerUserId: string, eventId: string): Promise<ClosingSnapshot> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  await db.update(collectEvents).set({ paypayCheckedAt: new Date() }).where(eq(collectEvents.id, event.id));
  return closingSnapshot(db, ownerUserId, eventId);
}

/**
 * 締める（POST …/close。FR-045）。精算していない人（現金を受け取ったのに精算していない・精算のあとで変わった）がいても締め、その鍵を返す。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns 締めた時刻と、精算していない人の鍵
 */
export async function closeEvent(db: Db, ownerUserId: string, eventId: string): Promise<{ closedAt: string; unsettled: string[] }> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const closedAt = new Date();
  // 締めたときの版は、締めを書く文の中で読む（読んでから書くまでに記録が足されても、その版を残す）
  await db
    .update(collectEvents)
    .set({ closedAt, closedVersion: sql`${collectEvents.version}` })
    .where(eq(collectEvents.id, event.id));
  const unsettled = cashReceivers(await loadClosingRows(db, event))
    .filter((r) => r.amount > 0 && (!r.settledAt || r.changedAfterSettle))
    .map((r) => r.receiverKey);
  return { closedAt: closedAt.toISOString(), unsettled };
}

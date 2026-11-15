// イベントと料金の区分（specs/collect/001-event-day-collection contracts/api.md 2、FR-010〜FR-012、tasks.md T024）。
// 消す（まとめを残す）は PR3。一覧の数（名簿の人数など）は data-model.md 4 のとおり毎回数える。
import type {
  CollectEvent,
  CollectEventListItem,
  CollectTier,
  CollectTierInput,
  CreateCollectEventRequest,
  UpdateCollectEventRequest,
} from "@meguru/shared";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { loadOwnedEvent, type CollectEventRow } from "../access";
import { assertOwnCandidate, postedMediaOf } from "../threads-candidates/candidate-service";
import { collectEvents, collectPriceTiers, collectReceptionRecords, collectRosterPeople } from "../schema";

type TierRow = typeof collectPriceTiers.$inferSelect;

/**
 * 料金の区分の行を応答の形にする。
 * @param row - price_tiers の行
 * @returns 料金の区分
 */
export function toTier(row: TierRow): CollectTier {
  return { id: row.id, name: row.name, amount: row.amount, position: row.position };
}

/**
 * イベントの行と区分を、応答の形にする。
 * @param row - events の行
 * @param tiers - そのイベントの区分（並び順）
 * @returns イベント
 */
export function toEvent(row: CollectEventRow, tiers: TierRow[]): CollectEvent {
  return {
    id: row.id,
    name: row.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    venue: row.venue,
    capacity: row.capacity,
    methods: row.methods as CollectEvent["methods"],
    tiers: tiers.map(toTier),
    checkInMode: row.checkInMode as CollectEvent["checkInMode"],
    closedAt: row.closedAt?.toISOString() ?? null,
    sourceThreadsPromotionId: row.sourceThreadsPromotionId,
    sourceChangedAt: row.sourceChangedAt?.toISOString() ?? null,
    sourceDeletedAt: row.sourceDeletedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * イベントの区分を並び順で読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param eventId - イベントの番号
 * @returns 区分の行
 */
export async function loadTiers(db: Db | TxDb, eventId: string): Promise<TierRow[]> {
  return db.select().from(collectPriceTiers).where(eq(collectPriceTiers.eventId, eventId)).orderBy(asc(collectPriceTiers.position), asc(collectPriceTiers.id));
}

/** 日本時間の時差（ミリ秒）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 日本時間の今日の0時（UTCの時刻）。
 * @param now - 今
 * @returns 今日の0時
 */
function startOfTodayJst(now: Date): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS);
}

/**
 * 一覧の並び（開催日時の近い順。FR-012）：今日（日本時間）からのイベントを開催日時の早い順に、そのあとに過ぎたイベントを新しい順に。
 * @param events - 一覧の行
 * @param now - 今
 * @returns 並べた一覧
 */
export function sortByNearest<T extends { startsAt: string }>(events: T[], now: Date): T[] {
  const today = startOfTodayJst(now).getTime();
  const time = (e: T) => new Date(e.startsAt).getTime();
  const upcoming = events.filter((e) => time(e) >= today).sort((a, b) => time(a) - time(b));
  const past = events.filter((e) => time(e) < today).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past];
}

/**
 * 主催者のイベントの一覧（FR-012）。名簿の人数・来場の数・振込待ちの数を、イベントごとにまとめて数える。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param now - 今（並びの基準）
 * @returns 一覧の行
 */
export async function listEvents(db: Db, ownerUserId: string, now: Date): Promise<CollectEventListItem[]> {
  const events = await db.select().from(collectEvents).where(eq(collectEvents.ownerUserId, ownerUserId));
  // 名簿の人数はイベントごとにまとめて数える（1回の問い合わせ）
  const counts =
    events.length === 0
      ? []
      : await db
          .select({ eventId: collectRosterPeople.eventId, n: count() })
          .from(collectRosterPeople)
          .where(inArray(collectRosterPeople.eventId, events.map((e) => e.id)))
          .groupBy(collectRosterPeople.eventId);
  const rosterCount = new Map(counts.map((r) => [r.eventId, Number(r.n)]));
  const recordCounts =
    events.length === 0
      ? []
      : await db
          .select({
            eventId: collectReceptionRecords.eventId,
            attended: count(),
            awaiting: sql<number>`count(*) FILTER (WHERE ${collectReceptionRecords.paymentStatus} = 'awaiting_transfer')`.mapWith(Number),
          })
          .from(collectReceptionRecords)
          .where(inArray(collectReceptionRecords.eventId, events.map((e) => e.id)))
          .groupBy(collectReceptionRecords.eventId);
  const records = new Map(recordCounts.map((r) => [r.eventId, r]));
  const items = events.map((event) => ({
    id: event.id,
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    venue: event.venue,
    closedAt: event.closedAt?.toISOString() ?? null,
    rosterCount: rosterCount.get(event.id) ?? 0,
    attendedCount: Number(records.get(event.id)?.attended ?? 0),
    awaitingTransferCount: records.get(event.id)?.awaiting ?? 0,
    fromThreads: event.sourceThreadsPromotionId !== null,
  }));
  return sortByNearest(items, now);
}

/**
 * 主催者のイベントを読む（区分つき）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns イベント
 * @throws AppError ITEM_NOT_FOUND
 */
export async function getEvent(db: Db, ownerUserId: string, eventId: string): Promise<CollectEvent> {
  const row = await loadOwnedEvent(db, ownerUserId, eventId);
  const event = toEvent(row, await loadTiers(db, row.id));
  // Threads から作ったイベントは、元の宣伝内容で掲載済みの媒体を添える（名簿の媒体のボタンで先に並べる。FR-064）
  if (row.sourceThreadsPromotionId) event.threadsPostedMedia = await postedMediaOf(db, row.sourceThreadsPromotionId);
  return event;
}

/**
 * 区分を並びのとおりに足す。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param tiers - 区分と並び順
 */
async function insertTiers(tx: TxDb, eventId: string, tiers: { name: string; amount: number; position: number }[]): Promise<void> {
  if (tiers.length === 0) return;
  await tx.insert(collectPriceTiers).values(tiers.map((t) => ({ eventId, name: t.name, amount: t.amount, position: t.position })));
}

/**
 * イベントを作る（FR-010）。区分は並びのとおりに足す（入力の id は無視する）。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param input - 検証済みの入力
 * @returns 作ったイベント
 */
export async function createEvent(databaseUrl: string, ownerUserId: string, input: CreateCollectEventRequest): Promise<CollectEvent> {
  return withTransaction(databaseUrl, async (tx) => {
    // Threads の候補から作るときは、その主催者に見せている候補だけ（FR-062）
    if (input.sourceThreadsPromotionId) await assertOwnCandidate(tx, ownerUserId, input.sourceThreadsPromotionId);
    const [row] = await tx
      .insert(collectEvents)
      .values({
        ownerUserId,
        name: input.name,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        venue: input.venue,
        capacity: input.capacity,
        methods: input.methods,
        sourceThreadsPromotionId: input.sourceThreadsPromotionId,
        // 省いたら名簿あり（前からの呼び方を変えない。新しいイベントの既定の名簿なしは画面が渡す。specs/collect/004 research.md R1）
        checkInMode: input.checkInMode ?? "roster",
      })
      .returning();
    await insertTiers(tx, row!.id, input.tiers.map((t, i) => ({ name: t.name, amount: t.amount, position: i })));
    return toEvent(row!, await loadTiers(tx, row!.id));
  });
}

/**
 * 区分を、渡された全部の区分（並びのとおり）に合わせる。id のあるものは直し、ないものは足し、渡されなかった区分は消す。
 * 名簿の人か受付の記録が使っている区分は消せない（409 TIER_IN_USE。受付で変えた区分は記録にだけある。R17）。
 * @param tx - トランザクション（イベントの行はロック済み）
 * @param eventId - イベントの番号
 * @param tiers - 渡された区分
 * @throws AppError VALIDATION_FAILED（ほかのイベントの区分の id）・TIER_IN_USE
 */
async function replaceTiers(tx: TxDb, eventId: string, tiers: CollectTierInput[]): Promise<void> {
  const existing = await loadTiers(tx, eventId);
  const existingIds = new Set(existing.map((t) => t.id));
  if (tiers.some((t) => t.id && !existingIds.has(t.id))) {
    throw new AppError("VALIDATION_FAILED", 400, "unknown tier", undefined, ["tiers"]);
  }
  const keep = new Set(tiers.flatMap((t) => (t.id ? [t.id] : [])));
  const removed = existing.filter((t) => !keep.has(t.id)).map((t) => t.id);
  if (removed.length > 0) {
    const [used] = await tx
      .select({ n: count() })
      .from(collectRosterPeople)
      .where(and(eq(collectRosterPeople.eventId, eventId), inArray(collectRosterPeople.priceTierId, removed)));
    const [recorded] = await tx
      .select({ n: count() })
      .from(collectReceptionRecords)
      .where(and(eq(collectReceptionRecords.eventId, eventId), inArray(collectReceptionRecords.priceTierId, removed)));
    if ((used?.n ?? 0) + (recorded?.n ?? 0) > 0) throw new AppError("TIER_IN_USE", 409, "tier in use");
    await tx.delete(collectPriceTiers).where(and(eq(collectPriceTiers.eventId, eventId), inArray(collectPriceTiers.id, removed)));
  }
  for (const [i, t] of tiers.entries()) {
    if (!t.id) continue;
    await tx
      .update(collectPriceTiers)
      .set({ name: t.name, amount: t.amount, position: i })
      .where(and(eq(collectPriceTiers.id, t.id), eq(collectPriceTiers.eventId, eventId)));
  }
  await insertTiers(
    tx,
    eventId,
    tiers.flatMap((t, i) => (t.id ? [] : [{ name: t.name, amount: t.amount, position: i }])),
  );
}

/**
 * イベントを直す（FR-011）。受付の画面に関わる変更なので、版を1上げる。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param input - 検証済みの入力（省いた項目は変えない）
 * @returns 直したイベント
 * @throws AppError ITEM_NOT_FOUND・VALIDATION_FAILED（終わりが始まりより前）・TIER_IN_USE
 */
export async function updateEvent(
  databaseUrl: string,
  ownerUserId: string,
  eventId: string,
  input: UpdateCollectEventRequest,
): Promise<CollectEvent> {
  return withTransaction(databaseUrl, async (tx) => {
    const current = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    const startsAt = input.startsAt !== undefined ? new Date(input.startsAt) : current.startsAt;
    const endsAt = input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : current.endsAt;
    if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new AppError("VALIDATION_FAILED", 400, "endsAt must be after startsAt", undefined, ["endsAt"]);
    }
    if (input.tiers) await replaceTiers(tx, current.id, input.tiers);
    const [row] = await tx
      .update(collectEvents)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        startsAt,
        endsAt,
        ...(input.venue !== undefined ? { venue: input.venue } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.methods !== undefined ? { methods: input.methods } : {}),
        ...(input.checkInMode !== undefined ? { checkInMode: input.checkInMode } : {}),
        version: sql`${collectEvents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(collectEvents.id, current.id))
      .returning();
    return toEvent(row!, await loadTiers(tx, current.id));
  });
}

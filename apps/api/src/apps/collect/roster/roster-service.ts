// 名簿（specs/collect/001-event-day-collection contracts/api.md 3、FR-020〜FR-026、research.md R8・R9、tasks.md T025）。
// 受付番号は、イベントの next_number を同じトランザクションで UPDATE … RETURNING して取る（同時に足しても重ならない。消しても戻さない）。
// 名簿を変えたら、イベントの版を1上げる（会場の共有は PR2 でつなぐ）。紹介した人（specs/collect/003 FR-020）も名簿の人に持つ。
import {
  COLLECT_LIMITS,
  cleanPastedLine,
  nameKey,
  referrerKey,
  type AddRosterPersonRequest,
  type BulkAddRosterRequest,
  type CollectMedia,
  type RosterPerson,
  type UpdateRosterPersonRequest,
} from "@meguru/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent } from "../access";
import { collectEvents, collectPriceTiers, collectRosterPeople } from "../schema";

type PersonRow = typeof collectRosterPeople.$inferSelect;

/**
 * 名簿の人の行を応答の形にする。
 * @param row - roster_people の行
 * @returns 名簿の人
 */
export function toPerson(row: PersonRow): RosterPerson {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    kana: row.kana,
    media: row.media as CollectMedia,
    priceTierId: row.priceTierId,
    memo: row.memo,
    referrer: row.referrer,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 紹介した人の列（名前と見比べるための形。specs/collect/003 research.md R4）。
 * @param referrer - 紹介した人（空は null）
 * @returns referrer と referrer_key
 */
export function referrerColumns(referrer: string | null | undefined): { referrer: string | null; referrerKey: string | null } {
  return referrer ? { referrer, referrerKey: referrerKey(referrer) } : { referrer: null, referrerKey: null };
}

/**
 * ない・ほかのイベントの名簿の人。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
const personNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "person not found");

/**
 * 料金の区分がそのイベントのものかを確かめる。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param priceTierId - 区分の番号
 * @throws AppError VALIDATION_FAILED（ほかのイベントの区分・ない区分）
 */
async function assertTierOfEvent(tx: TxDb, eventId: string, priceTierId: string): Promise<void> {
  const [tier] = await tx
    .select({ id: collectPriceTiers.id })
    .from(collectPriceTiers)
    .where(and(eq(collectPriceTiers.id, priceTierId), eq(collectPriceTiers.eventId, eventId)))
    .limit(1);
  if (!tier) throw new AppError("VALIDATION_FAILED", 400, "unknown tier", undefined, ["priceTierId"]);
}

/**
 * 受付番号を n 個取り、版を1上げる（イベントの行をロックする。R8）。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param n - 取る数
 * @returns 最初の番号と、新しい版
 */
async function takeNumbers(tx: TxDb, eventId: string, n: number): Promise<{ first: number; version: number }> {
  const [row] = await tx
    .update(collectEvents)
    .set({ nextNumber: sql`${collectEvents.nextNumber} + ${n}`, version: sql`${collectEvents.version} + 1`, updatedAt: new Date() })
    .where(eq(collectEvents.id, eventId))
    .returning({ next: collectEvents.nextNumber, version: collectEvents.version });
  return { first: row!.next - n, version: row!.version };
}

/**
 * 版を1上げる（名簿を直した・消したとき）。
 * @param tx - トランザクション
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
 * 名簿の一覧（受付番号の順）と、イベントの版。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns 名簿の人と版
 */
export async function listRoster(db: Db, ownerUserId: string, eventId: string): Promise<{ people: RosterPerson[]; version: number }> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const rows = await db.select().from(collectRosterPeople).where(eq(collectRosterPeople.eventId, event.id)).orderBy(asc(collectRosterPeople.number));
  return { people: rows.map(toPerson), version: event.version };
}

/**
 * 1人足す（FR-020・FR-023・FR-024）。同じイベントに同じ名前（nameKey が同じ）の人がいれば、その人の受付番号と媒体を返す（足すことは止めない）。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param input - 検証済みの入力
 * @returns 足した人・同じ名前の人・新しい版
 */
export async function addPerson(
  databaseUrl: string,
  ownerUserId: string,
  eventId: string,
  input: AddRosterPersonRequest,
): Promise<{ person: RosterPerson; sameNameAs: { number: number; media: CollectMedia } | null; version: number }> {
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    const { first, version } = await takeNumbers(tx, event.id, 1);
    await assertTierOfEvent(tx, event.id, input.priceTierId);
    const key = nameKey(input.name);
    const [same] = await tx
      .select({ number: collectRosterPeople.number, media: collectRosterPeople.media })
      .from(collectRosterPeople)
      .where(and(eq(collectRosterPeople.eventId, event.id), eq(collectRosterPeople.nameKey, key)))
      .orderBy(asc(collectRosterPeople.number))
      .limit(1);
    const [row] = await tx
      .insert(collectRosterPeople)
      .values({
        eventId: event.id,
        number: first,
        name: input.name,
        nameKey: key,
        kana: input.kana,
        kanaKey: input.kana ? nameKey(input.kana) : null,
        media: input.media,
        priceTierId: input.priceTierId,
        memo: input.memo,
        ...referrerColumns(input.referrer),
      })
      .returning();
    return {
      person: toPerson(row!),
      sameNameAs: same ? { number: same.number, media: same.media as CollectMedia } : null,
      version,
    };
  });
}

/**
 * まとめて足す（FR-022・FR-026）。APIでも各行に cleanPastedLine を当て、空になった行を除く。番号は行の順に続けて振る。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param input - 検証済みの入力
 * @returns 足した人と新しい版
 * @throws AppError VALIDATION_FAILED（整えると1行も残らない・50文字を超える行・ない区分）
 */
export async function addPeopleBulk(
  databaseUrl: string,
  ownerUserId: string,
  eventId: string,
  input: BulkAddRosterRequest,
): Promise<{ people: RosterPerson[]; version: number }> {
  const names = input.names.map(cleanPastedLine).filter((n) => n !== "");
  // 整えても長すぎる行は、黙って切らずに入力の誤りにする（画面の確かめの一覧で直してもらう）
  if (names.length === 0 || names.some((n) => [...n].length > COLLECT_LIMITS.personName)) {
    throw new AppError("VALIDATION_FAILED", 400, "invalid names", undefined, ["names"]);
  }
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    const { first, version } = await takeNumbers(tx, event.id, names.length);
    await assertTierOfEvent(tx, event.id, input.priceTierId);
    const rows = await tx
      .insert(collectRosterPeople)
      .values(
        names.map((name, i) => ({
          eventId: event.id,
          number: first + i,
          name,
          nameKey: nameKey(name),
          media: input.media,
          priceTierId: input.priceTierId,
          ...referrerColumns(input.referrer),
        })),
      )
      .returning();
    return { people: rows.sort((a, b) => a.number - b.number).map(toPerson), version };
  });
}

/**
 * 名簿の人を直す（FR-025）。受付番号は変えない。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param personId - 名簿の人の番号
 * @param input - 検証済みの入力（省いた項目は変えない）
 * @returns 直した人と新しい版
 * @throws AppError ITEM_NOT_FOUND・VALIDATION_FAILED（ない区分）
 */
export async function updatePerson(
  databaseUrl: string,
  ownerUserId: string,
  eventId: string,
  personId: string,
  input: UpdateRosterPersonRequest,
): Promise<{ person: RosterPerson; version: number }> {
  if (!isUuid(personId)) throw personNotFound();
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    if (input.priceTierId !== undefined) await assertTierOfEvent(tx, event.id, input.priceTierId);
    const [row] = await tx
      .update(collectRosterPeople)
      .set({
        ...(input.name !== undefined ? { name: input.name, nameKey: nameKey(input.name) } : {}),
        ...(input.kana !== undefined ? { kana: input.kana, kanaKey: input.kana ? nameKey(input.kana) : null } : {}),
        ...(input.media !== undefined ? { media: input.media } : {}),
        ...(input.priceTierId !== undefined ? { priceTierId: input.priceTierId } : {}),
        ...(input.memo !== undefined ? { memo: input.memo } : {}),
        ...(input.referrer !== undefined ? referrerColumns(input.referrer) : {}),
      })
      .where(and(eq(collectRosterPeople.id, personId), eq(collectRosterPeople.eventId, event.id)))
      .returning();
    if (!row) throw personNotFound();
    return { person: toPerson(row), version: await bumpVersion(tx, event.id) };
  });
}

/**
 * 名簿の人を消す（FR-025。受付の記録も一緒に消える。受付番号は使い回さない）。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param personId - 名簿の人の番号
 * @returns 新しい版
 * @throws AppError ITEM_NOT_FOUND
 */
export async function deletePerson(databaseUrl: string, ownerUserId: string, eventId: string, personId: string): Promise<{ version: number }> {
  if (!isUuid(personId)) throw personNotFound();
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    const rows = await tx
      .delete(collectRosterPeople)
      .where(and(eq(collectRosterPeople.id, personId), eq(collectRosterPeople.eventId, event.id)))
      .returning({ id: collectRosterPeople.id });
    if (rows.length === 0) throw personNotFound();
    return { version: await bumpVersion(tx, event.id) };
  });
}

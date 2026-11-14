// 名簿なしで受付する（specs/collect/004-rosterless-check-in contracts/api.md 2-2・3-3、research.md R2・R3・R5〜R7）。
// 参加者がセルフ受付で名前・媒体を入れると、確かめなしで名簿に入れ、すぐ「名簿に入れた」申し出を作る（002 の me → 払い方の選択をそのまま使う）。
// 区分が2つ以上なら仮の区分で区分を未定にする。主催者が先に入れた人と名前が1人だけ一致すれば、その人に当てる。
import {
  SELF_CHECK_IN_LIMITS,
  nameKey,
  provisionalTier,
  tierUndecidedFor,
  type ReceptionPerson,
  type SelfEntryRequest,
  type SelfEntryResponse,
} from "@meguru/shared";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { withTransaction, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadActorEvent, type ReceptionActor } from "../access";
import { toReceptionPerson } from "../reception/reception-service";
import { referrerColumns } from "../roster/roster-service";
import { collectEvents, collectPriceTiers, collectReceptionRecords, collectRosterPeople, collectSelfCheckInRequests } from "../schema";
import { bump, selfPersonOf, type SelfLinkRow } from "./self-service";

const MINUTE_MS = 60_000;

/** 名簿なしの入口で作った申し出（client_request_id のある行）。 */
const isEntry = isNotNull(collectSelfCheckInRequests.clientRequestId);

/**
 * 名簿なしの入口の上限を確かめる（research R6）。端末ごと・リンクの1分・リンク全体。
 * @param tx - トランザクション（イベントの行をロックしたあと）
 * @param link - リンク
 * @param deviceHash - 端末の印のハッシュ
 * @param now - 今
 * @throws AppError RATE_LIMITED（429）
 */
async function assertEntryLimits(tx: TxDb, link: SelfLinkRow, deviceHash: string, now: Date): Promise<void> {
  const [counts] = await tx
    .select({
      device: sql<number>`count(*) FILTER (WHERE ${collectSelfCheckInRequests.deviceHash} = ${deviceHash})`.mapWith(Number),
      minute: sql<number>`count(*) FILTER (WHERE ${collectSelfCheckInRequests.createdAt} > ${new Date(now.getTime() - MINUTE_MS)})`.mapWith(Number),
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(collectSelfCheckInRequests)
    .where(and(eq(collectSelfCheckInRequests.linkId, link.id), isEntry));
  if (
    (counts?.device ?? 0) >= SELF_CHECK_IN_LIMITS.entriesPerDevicePerLink ||
    (counts?.minute ?? 0) >= SELF_CHECK_IN_LIMITS.entriesPerLinkPerMinute ||
    (counts?.total ?? 0) >= SELF_CHECK_IN_LIMITS.entriesPerLink
  ) {
    throw new AppError("RATE_LIMITED", 429, "too many entries");
  }
}

/**
 * 主催者が先に入れた人のうち、名前が一致して受付の記録がない人を探す（research R5）。1人だけのときに返す。
 * 名簿なしで入った人どうしは当てない（他人の名前で入れて、ほかの人の受付に割り込めないように）。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param key - 名前の nameKey
 * @returns 当てる人（いない・2人以上なら undefined）
 */
async function preEnteredMatch(tx: TxDb, eventId: string, key: string) {
  const rows = await tx
    .select({ id: collectRosterPeople.id, referrer: collectRosterPeople.referrer })
    .from(collectRosterPeople)
    .leftJoin(collectReceptionRecords, eq(collectReceptionRecords.rosterPersonId, collectRosterPeople.id))
    .where(
      and(
        eq(collectRosterPeople.eventId, eventId),
        eq(collectRosterPeople.nameKey, key),
        isNull(collectRosterPeople.selfEnteredAt),
        isNull(collectReceptionRecords.rosterPersonId),
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0] : undefined;
}

/**
 * 名簿なしで名簿に入る（POST /api/collect/s/:token/entries。spec FR-010〜FR-016）。
 * @param databaseUrl - 接続文字列
 * @param link - 使えるセルフ受付のリンク
 * @param deviceHash - 端末の印のハッシュ
 * @param input - 検証済みの入力
 * @param now - 今
 * @returns 応答・新しい版・送り直しだったか・会場の共有に送る名簿の人
 * @throws AppError CHECK_IN_MODE_MISMATCH（409）・RATE_LIMITED（429）・VALIDATION_FAILED
 */
export async function createEntry(
  databaseUrl: string,
  link: SelfLinkRow,
  deviceHash: string,
  input: SelfEntryRequest,
  now: Date,
): Promise<{ response: SelfEntryResponse; version: number; replayed: boolean; person: ReceptionPerson | null }> {
  return withTransaction(databaseUrl, async (tx) => {
    const [event] = await tx.select().from(collectEvents).where(eq(collectEvents.id, link.eventId)).for("update");
    if (!event) throw new AppError("ITEM_NOT_FOUND", 404, "link not found");
    if (event.checkInMode !== "rosterless") throw new AppError("CHECK_IN_MODE_MISMATCH", 409, "event uses a roster");
    // 送り直し：同じ clientRequestId の申し出があれば、前と同じ人を返す
    const [replay] = await tx
      .select()
      .from(collectSelfCheckInRequests)
      .where(eq(collectSelfCheckInRequests.clientRequestId, input.clientRequestId))
      .limit(1);
    if (replay) {
      if (replay.linkId !== link.id || replay.deviceHash !== deviceHash) {
        throw new AppError("VALIDATION_FAILED", 400, "clientRequestId already used", undefined, ["clientRequestId"]);
      }
      const person = replay.rosterPersonId ? await selfPersonOf(tx, replay.rosterPersonId, event.id) : undefined;
      if (!person) throw new AppError("ITEM_NOT_FOUND", 404, "entry removed");
      return { response: { requestId: replay.id, person }, version: event.version, replayed: true, person: null };
    }
    await assertEntryLimits(tx, link, deviceHash, now);
    const key = nameKey(input.name);
    if (key === "") throw new AppError("VALIDATION_FAILED", 400, "name required", undefined, ["name"]);

    const match = await preEnteredMatch(tx, event.id, key);
    let personId: string;
    if (match) {
      // 主催者が先に入れた人に当てる。紹介した人が空なら、参加者が入れたもので埋める（媒体は変えない）
      if (!match.referrer && input.referrer) {
        await tx.update(collectRosterPeople).set(referrerColumns(input.referrer)).where(eq(collectRosterPeople.id, match.id));
      }
      personId = match.id;
    } else {
      const tiers = await tx
        .select({ id: collectPriceTiers.id, amount: collectPriceTiers.amount, position: collectPriceTiers.position })
        .from(collectPriceTiers)
        .where(eq(collectPriceTiers.eventId, event.id))
        .orderBy(asc(collectPriceTiers.position));
      const tier = provisionalTier(tiers);
      if (!tier) throw new AppError("VALIDATION_FAILED", 400, "event has no tier", undefined, ["priceTierId"]);
      const [numbered] = await tx
        .update(collectEvents)
        .set({ nextNumber: sql`${collectEvents.nextNumber} + 1`, updatedAt: now })
        .where(eq(collectEvents.id, event.id))
        .returning({ next: collectEvents.nextNumber });
      const [created] = await tx
        .insert(collectRosterPeople)
        .values({
          eventId: event.id,
          number: numbered!.next - 1,
          name: input.name,
          nameKey: key,
          kana: input.kana,
          kanaKey: input.kana ? nameKey(input.kana) : null,
          media: input.media,
          priceTierId: tier.id,
          ...referrerColumns(input.referrer),
          tierUndecided: tierUndecidedFor(tiers),
          selfEnteredAt: now,
        })
        .returning({ id: collectRosterPeople.id });
      personId = created!.id;
    }
    const [request] = await tx
      .insert(collectSelfCheckInRequests)
      .values({
        eventId: event.id,
        linkId: link.id,
        name: input.name,
        nameKey: key,
        kana: input.kana,
        deviceHash,
        status: match ? "matched" : "accepted",
        rosterPersonId: personId,
        resolvedAt: now,
        clientRequestId: input.clientRequestId,
      })
      .returning({ id: collectSelfCheckInRequests.id });
    const version = await bump(tx, event.id);
    const [row] = await tx.select().from(collectRosterPeople).where(eq(collectRosterPeople.id, personId));
    const person = (await selfPersonOf(tx, personId, event.id))!;
    return { response: { requestId: request!.id, person }, version, replayed: false, person: toReceptionPerson(row!, false) };
  });
}

/**
 * 名簿なしで入った人を名簿から外す（DELETE …/reception/:personId/entry。spec FR-024、research R7）。
 * 名簿なしで入った人で、受付の記録がない人だけ。手伝う人も外せる。
 * @param databaseUrl - 接続文字列
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @param personId - 名簿の人の番号
 * @returns 新しい版
 * @throws AppError ITEM_NOT_FOUND（いない・名簿なしで入った人でない）・ALREADY_RECORDED（記録がある）
 */
export async function removeEntry(databaseUrl: string, actor: ReceptionActor, eventId: string, personId: string): Promise<{ version: number }> {
  if (!isUuid(personId)) throw new AppError("ITEM_NOT_FOUND", 404, "person not found");
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadActorEvent(tx, actor, eventId, { forUpdate: true });
    const [person] = await tx
      .select({ id: collectRosterPeople.id })
      .from(collectRosterPeople)
      .where(and(eq(collectRosterPeople.id, personId), eq(collectRosterPeople.eventId, event.id), isNotNull(collectRosterPeople.selfEnteredAt)))
      .limit(1);
    if (!person) throw new AppError("ITEM_NOT_FOUND", 404, "person not found");
    const [record] = await tx
      .select({ id: collectReceptionRecords.rosterPersonId })
      .from(collectReceptionRecords)
      .where(eq(collectReceptionRecords.rosterPersonId, person.id))
      .limit(1);
    if (record) throw new AppError("ALREADY_RECORDED", 409, "already recorded");
    await tx.delete(collectRosterPeople).where(eq(collectRosterPeople.id, person.id));
    return { version: await bump(tx, event.id) };
  });
}

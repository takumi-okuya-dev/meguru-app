// セルフ受付：参加者（ログインなし）の探す・本人の申告・自分の状態・回数の上限（specs/collect/002-self-check-in contracts/api.md 3、
// research.md R2・R3・R5・R6）。参加者には、完全に一致した本人の名前・受付番号・区分と金額だけを返す（ほかの参加者の名前は返さない）。
// 本人の申告は受付の記録として残すが、現金・PayPayは「確かめ待ち」、振込は振込待ちにする（受け取った人は self）。
import {
  SELF_CHECK_IN_LIMITS,
  isReceptionMethodAllowed,
  mediaInOrder,
  nameKey,
  tierUndecidedFor,
  type ReceptionRecord,
  type SelfDeclareRequest,
  type SelfLinkInfo,
  type SelfMe,
  type SelfPerson,
  type SelfSearchResponse,
} from "@meguru/shared";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { sha256Hex } from "../../../kernel/identifier-hash";
import { isUuid } from "../../../kernel/validate";
import { toRecord } from "../reception/reception-service";
import { postedMediaOf } from "../threads-candidates/candidate-service";
import {
  collectEvents,
  collectOwnerSettings,
  collectPriceTiers,
  collectReceptionLinks,
  collectReceptionRecords,
  collectRosterPeople,
  collectSelfCheckInDevices,
  collectSelfCheckInRequests,
} from "../schema";

/** セルフ受付のリンクの行。 */
export type SelfLinkRow = typeof collectReceptionLinks.$inferSelect;

/**
 * ないリンク。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
const linkNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "link not found");
/** 敬称（名前の後ろ）。 */
const HONORIFIC = /\s*(?:様|さま|さん|殿|くん|ちゃん)$/u;
const MINUTE_MS = 60_000;

/**
 * トークンからセルフ受付のリンクを引く（手伝う人のリンクでは入れない）。
 * @param db - データベース
 * @param token - 道筋の :token
 * @returns リンクの行
 */
async function linkByToken(db: Db | TxDb, token: string): Promise<SelfLinkRow | undefined> {
  if (!token.startsWith("cs_") || token.length > 100) return undefined;
  const [row] = await db
    .select()
    .from(collectReceptionLinks)
    .where(and(eq(collectReceptionLinks.tokenHash, await sha256Hex(token)), eq(collectReceptionLinks.kind, "self")))
    .limit(1);
  return row;
}

/**
 * リンクの状態。
 * @param link - リンク
 * @param now - 今
 * @returns active・stopped・expired
 */
function statusOf(link: SelfLinkRow, now: Date): SelfLinkInfo["status"] {
  if (link.stoppedAt) return "stopped";
  return link.expiresAt > now ? "active" : "expired";
}

/**
 * 参加者の端末の印をハッシュにする（UUID でなければ 400）。
 * @param raw - 見出しの値
 * @returns ハッシュ
 */
export async function deviceHashOf(raw: string | undefined): Promise<string> {
  if (!raw || !isUuid(raw)) throw new AppError("VALIDATION_FAILED", 400, "device required", undefined, ["device"]);
  return sha256Hex(`self:${raw}`);
}

/**
 * リンクを引き、状態を返す（止めた・期限が過ぎたリンクでも返す）。
 * @param db - データベース
 * @param token - 道筋の :token
 * @returns リンク
 * @throws AppError ITEM_NOT_FOUND
 */
export async function loadSelfLink(db: Db | TxDb, token: string): Promise<SelfLinkRow> {
  const link = await linkByToken(db, token);
  if (!link) throw linkNotFound();
  return link;
}

/**
 * 使えるリンクを引く。
 * @param db - データベース
 * @param token - 道筋の :token
 * @param now - 今
 * @returns リンク
 * @throws AppError ITEM_NOT_FOUND・LINK_INACTIVE（410）
 */
export async function activeSelfLink(db: Db | TxDb, token: string, now: Date): Promise<SelfLinkRow> {
  const link = await loadSelfLink(db, token);
  if (statusOf(link, now) !== "active") throw new AppError("LINK_INACTIVE", 410, "link inactive");
  return link;
}

/**
 * リンクを開いた画面に出すもの（イベントの名前・日時・会場・払い方と、PayPayのQRの有無・振込先の案内だけ）。
 * @param db - データベース
 * @param token - 道筋の :token
 * @param now - 今
 * @returns 状態とイベント
 */
export async function selfLinkInfo(db: Db, token: string, now: Date): Promise<SelfLinkInfo> {
  const link = await loadSelfLink(db, token);
  const [event] = await db
    .select({
      name: collectEvents.name,
      startsAt: collectEvents.startsAt,
      venue: collectEvents.venue,
      methods: collectEvents.methods,
      ownerUserId: collectEvents.ownerUserId,
      checkInMode: collectEvents.checkInMode,
      sourceThreadsPromotionId: collectEvents.sourceThreadsPromotionId,
    })
    .from(collectEvents)
    .where(eq(collectEvents.id, link.eventId))
    .limit(1);
  if (!event) throw linkNotFound();
  const [settings] = await db
    .select({ hasPaypayQr: sql<boolean>`${collectOwnerSettings.paypayQr} IS NOT NULL`, bankText: collectOwnerSettings.bankText })
    .from(collectOwnerSettings)
    .where(eq(collectOwnerSettings.ownerUserId, event.ownerUserId))
    .limit(1);
  const rosterless = event.checkInMode === "rosterless";
  // 名簿なしで区分が2つ以上なら、参加者に区分ごとの金額を並べる（0円の区分は出さない。specs/collect/004 research.md R3）
  const tiers = rosterless
    ? await db
        .select({ name: collectPriceTiers.name, amount: collectPriceTiers.amount, position: collectPriceTiers.position })
        .from(collectPriceTiers)
        .where(eq(collectPriceTiers.eventId, link.eventId))
        .orderBy(collectPriceTiers.position)
    : [];
  return {
    status: statusOf(link, now),
    event: { name: event.name, startsAt: event.startsAt.toISOString(), venue: event.venue, methods: event.methods as SelfLinkInfo["event"]["methods"] },
    settings: { hasPaypayQr: settings?.hasPaypayQr ?? false, bankText: settings?.bankText ?? null },
    checkInMode: event.checkInMode as SelfLinkInfo["checkInMode"],
    media: rosterless ? mediaInOrder(event.sourceThreadsPromotionId ? await postedMediaOf(db, event.sourceThreadsPromotionId) : []) : [],
    tiers: tierUndecidedFor(tiers) ? tiers.filter((t) => t.amount > 0).map((t) => ({ name: t.name, amount: t.amount })) : [],
  };
}

/**
 * 探す回数を数え、上限を超えたら 429（端末ごとに1分に10回・リンク全体で1分に300回。research.md R2）。
 * @param db - データベース
 * @param link - リンク
 * @param deviceHash - 端末の印のハッシュ
 * @param now - 今
 * @throws AppError RATE_LIMITED（429）
 */
async function countSearch(db: Db, link: SelfLinkRow, deviceHash: string, now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() - MINUTE_MS);
  const [row] = await db
    .insert(collectSelfCheckInDevices)
    .values({ linkId: link.id, deviceHash, windowStartedAt: now, searchCount: 1 })
    .onConflictDoUpdate({
      target: [collectSelfCheckInDevices.linkId, collectSelfCheckInDevices.deviceHash],
      set: {
        searchCount: sql`CASE WHEN ${collectSelfCheckInDevices.windowStartedAt} < ${windowStart} THEN 1 ELSE ${collectSelfCheckInDevices.searchCount} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${collectSelfCheckInDevices.windowStartedAt} < ${windowStart} THEN ${now} ELSE ${collectSelfCheckInDevices.windowStartedAt} END`,
      },
    })
    .returning({ count: collectSelfCheckInDevices.searchCount });
  if ((row?.count ?? 0) > SELF_CHECK_IN_LIMITS.searchesPerDevicePerMinute) throw new AppError("RATE_LIMITED", 429, "too many searches");
  const [total] = await db
    .select({ n: sql<number>`coalesce(sum(${collectSelfCheckInDevices.searchCount}), 0)`.mapWith(Number) })
    .from(collectSelfCheckInDevices)
    .where(and(eq(collectSelfCheckInDevices.linkId, link.id), gt(collectSelfCheckInDevices.windowStartedAt, windowStart)));
  if ((total?.n ?? 0) > SELF_CHECK_IN_LIMITS.searchesPerLinkPerMinute) throw new AppError("RATE_LIMITED", 429, "too many searches");
}

/**
 * 名簿の人を、参加者に見せてよい形にする（名前・受付番号・区分と金額だけ）。
 * @param db - データベース
 * @param personId - 名簿の人の番号
 * @param eventId - イベントの番号
 * @returns 本人の情報（ないなら undefined）
 */
export async function selfPersonOf(db: Db | TxDb, personId: string, eventId: string): Promise<SelfPerson | undefined> {
  const [row] = await db
    .select({
      id: collectRosterPeople.id,
      number: collectRosterPeople.number,
      name: collectRosterPeople.name,
      tierName: collectPriceTiers.name,
      amount: collectPriceTiers.amount,
      tierUndecided: collectRosterPeople.tierUndecided,
    })
    .from(collectRosterPeople)
    .innerJoin(collectPriceTiers, eq(collectPriceTiers.id, collectRosterPeople.priceTierId))
    .where(and(eq(collectRosterPeople.id, personId), eq(collectRosterPeople.eventId, eventId)))
    .limit(1);
  return row;
}

/**
 * 参加者に見せる自分の記録。
 * @param r - 受付の記録
 * @returns 払い方・状態・金額
 */
const selfRecordOf = (r: { method: string; paymentStatus: string; amount: number }) => ({
  method: r.method,
  paymentStatus: r.paymentStatus as ReceptionRecord["paymentStatus"],
  amount: r.amount,
});

/**
 * 自分を探す（spec FR-011・FR-012）。名前・ふりがな（ひらがなとカタカナ・全角と半角・空白を区別しない。敬称は取り除く）か受付番号に、
 * 完全に一致した人だけを返す。同じ名前の人が2人以上なら ambiguous（受付番号を聞く）。
 * @param db - データベース
 * @param link - 使えるリンク
 * @param deviceHash - 端末の印のハッシュ
 * @param query - 入れた言葉
 * @param now - 今
 * @returns 結果
 */
export async function searchSelf(db: Db, link: SelfLinkRow, deviceHash: string, query: string, now: Date): Promise<SelfSearchResponse> {
  await countSearch(db, link, deviceHash, now);
  const normalized = query.normalize("NFKC").trim();
  // 受付番号は6桁まで（それより長い数字は、どの人にも当たらない）
  if (/^\d{7,}$/.test(normalized)) return { result: "not_found" };
  const byNumber = /^\d+$/.test(normalized);
  const key = nameKey(normalized.replace(HONORIFIC, ""));
  if (!byNumber && key === "") return { result: "not_found" };
  const rows = await db
    .select({ id: collectRosterPeople.id })
    .from(collectRosterPeople)
    .where(
      and(
        eq(collectRosterPeople.eventId, link.eventId),
        byNumber
          ? eq(collectRosterPeople.number, Number(normalized))
          : sql`(${collectRosterPeople.nameKey} = ${key} OR ${collectRosterPeople.kanaKey} = ${key})`,
      ),
    )
    .limit(2);
  if (rows.length === 0) return { result: "not_found" };
  if (rows.length > 1) return { result: "ambiguous" };
  const person = (await selfPersonOf(db, rows[0]!.id, link.eventId))!;
  const [record] = await db
    .select({ method: collectReceptionRecords.method, paymentStatus: collectReceptionRecords.paymentStatus, amount: collectReceptionRecords.amount })
    .from(collectReceptionRecords)
    .where(eq(collectReceptionRecords.rosterPersonId, person.id))
    .limit(1);
  return { result: "found", person, record: record ? selfRecordOf(record) : null };
}

/**
 * 本人の申告（spec FR-014〜FR-018）。現金・PayPayは確かめ待ち、振込は振込待ち、0円の区分は来場だけ（払い方は none・支払い済み）。
 * 受付済みなら 409。ただし同じ端末の、まだ確かめられていない本人の申告なら、払い方を選び直す。
 * @param databaseUrl - 接続文字列
 * @param link - 使えるリンク
 * @param deviceHash - 端末の印のハッシュ
 * @param input - 検証済みの入力
 * @returns 記録（受付をする人に知らせる形と、参加者に返す形）・新しい版・送り直しだったか
 * @throws AppError ITEM_NOT_FOUND・VALIDATION_FAILED・ALREADY_RECORDED
 */
export async function declareSelf(
  databaseUrl: string,
  link: SelfLinkRow,
  deviceHash: string,
  input: SelfDeclareRequest,
): Promise<{ record: ReceptionRecord; version: number; replayed: boolean; changed: boolean }> {
  return withTransaction(databaseUrl, async (tx) => {
    const [event] = await tx.select().from(collectEvents).where(eq(collectEvents.id, link.eventId)).for("update");
    if (!event) throw linkNotFound();
    const [replay] = await tx.select().from(collectReceptionRecords).where(eq(collectReceptionRecords.clientRequestId, input.clientRequestId)).limit(1);
    if (replay) {
      if (replay.rosterPersonId !== input.personId) throw new AppError("VALIDATION_FAILED", 400, "clientRequestId already used", undefined, ["clientRequestId"]);
      return { record: toRecord(replay), version: event.version, replayed: true, changed: false };
    }
    const person = await selfPersonOf(tx, input.personId, event.id);
    if (!person) throw new AppError("ITEM_NOT_FOUND", 404, "person not found");
    const [roster] = await tx.select({ priceTierId: collectRosterPeople.priceTierId }).from(collectRosterPeople).where(eq(collectRosterPeople.id, person.id));
    const free = person.amount === 0;
    if (!free && !input.method) throw new AppError("VALIDATION_FAILED", 400, "method required", undefined, ["method"]);
    const method = free ? "none" : input.method!;
    if (!isReceptionMethodAllowed(method, event.methods)) throw new AppError("VALIDATION_FAILED", 400, "method not used in this event", undefined, ["method"]);
    const transfer = method === "transfer_today" || method === "transfer_later";
    const paymentStatus = free ? "paid" : transfer ? "awaiting_transfer" : "awaiting_confirmation";
    const values = {
      method,
      priceTierId: roster!.priceTierId,
      amount: person.amount,
      amountOverridden: false,
      receiverKind: "self" as const,
      receiverHelperId: null,
      paymentStatus,
      selfReported: true,
      selfDeviceHash: deviceHash,
    };
    const [existing] = await tx.select().from(collectReceptionRecords).where(eq(collectReceptionRecords.rosterPersonId, person.id)).limit(1);
    if (existing) {
      // 同じ端末の、まだ確かめられていない本人の申告なら選び直せる（spec FR-017）
      // （振込の入金を確かめた・0円の来場だけは支払い済みなので選び直せない）
      const mine = existing.receiverKind === "self" && existing.selfDeviceHash === deviceHash && existing.paymentStatus !== "paid";
      if (!mine) throw new AppError("ALREADY_RECORDED", 409, "already recorded");
      const [row] = await tx
        .update(collectReceptionRecords)
        .set({ ...values, clientRequestId: input.clientRequestId, recordedAt: new Date() })
        .where(eq(collectReceptionRecords.rosterPersonId, person.id))
        .returning();
      return { record: toRecord(row!), version: await bump(tx, event.id), replayed: false, changed: true };
    }
    const [row] = await tx
      .insert(collectReceptionRecords)
      .values({ rosterPersonId: person.id, eventId: event.id, clientRequestId: input.clientRequestId, ...values })
      .returning();
    return { record: toRecord(row!), version: await bump(tx, event.id), replayed: false, changed: false };
  });
}

/**
 * 版を1上げる。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @returns 新しい版
 */
export async function bump(tx: TxDb, eventId: string): Promise<number> {
  const [row] = await tx
    .update(collectEvents)
    .set({ version: sql`${collectEvents.version} + 1`, updatedAt: new Date() })
    .where(eq(collectEvents.id, eventId))
    .returning({ version: collectEvents.version });
  return row!.version;
}

/**
 * 自分の端末の状態（spec FR-017・FR-019・FR-022。参加者の画面が3秒ごとに読む）。
 * @param db - データベース
 * @param link - リンク（止めた・期限が過ぎたものでもよい）
 * @param deviceHash - 端末の印のハッシュ
 * @param now - 今
 * @returns リンクの状態・最後の本人の申告・最後の申し出
 */
export async function selfMe(db: Db, link: SelfLinkRow, deviceHash: string, now: Date): Promise<SelfMe> {
  const [declared] = await db
    .select({ personId: collectReceptionRecords.rosterPersonId, method: collectReceptionRecords.method, paymentStatus: collectReceptionRecords.paymentStatus, amount: collectReceptionRecords.amount })
    .from(collectReceptionRecords)
    .where(and(eq(collectReceptionRecords.eventId, link.eventId), eq(collectReceptionRecords.selfDeviceHash, deviceHash)))
    .orderBy(desc(collectReceptionRecords.recordedAt))
    .limit(1);
  const [request] = await db
    .select({ id: collectSelfCheckInRequests.id, status: collectSelfCheckInRequests.status, personId: collectSelfCheckInRequests.rosterPersonId })
    .from(collectSelfCheckInRequests)
    .where(and(eq(collectSelfCheckInRequests.linkId, link.id), eq(collectSelfCheckInRequests.deviceHash, deviceHash)))
    .orderBy(desc(collectSelfCheckInRequests.createdAt))
    .limit(1);
  const declaredPerson = declared ? await selfPersonOf(db, declared.personId, link.eventId) : undefined;
  const requestPerson = request?.personId ? await selfPersonOf(db, request.personId, link.eventId) : undefined;
  return {
    status: statusOf(link, now),
    declaration: declared && declaredPerson ? { person: declaredPerson, record: selfRecordOf(declared) } : null,
    request: request ? { id: request.id, status: request.status as NonNullable<SelfMe["request"]>["status"], person: requestPerson ?? null } : null,
  };
}

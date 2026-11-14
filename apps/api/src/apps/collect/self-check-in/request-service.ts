// セルフ受付の飛び入りの申し出（specs/collect/002-self-check-in User Story 4、FR-020〜FR-023、research.md R4）。
// 参加者が名前を送り、受付をする人が名簿に入れる（001 の飛び入りと同じ）・名簿の人に当てる・断る。片付けたら版を上げる（呼ぶ側が知らせる）。
import { SELF_CHECK_IN_LIMITS, nameKey, type ReceptionPerson, type SelfRequest, type SelfRequestCreate } from "@meguru/shared";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError, pgErrorCode } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadActorEvent, type ReceptionActor } from "../access";
import { toReceptionPerson } from "../reception/reception-service";
import { collectEvents, collectPriceTiers, collectRosterPeople, collectSelfCheckInRequests } from "../schema";
import { bump, type SelfLinkRow } from "./self-service";

/**
 * イベントの待ちの申し出（受付の画面に出す）。
 * @param db - データベース
 * @param eventId - イベントの番号
 * @returns 待ちの申し出（古い順）
 */
export async function pendingRequests(db: Db | TxDb, eventId: string): Promise<SelfRequest[]> {
  const rows = await db
    .select({ id: collectSelfCheckInRequests.id, name: collectSelfCheckInRequests.name, kana: collectSelfCheckInRequests.kana, createdAt: collectSelfCheckInRequests.createdAt })
    .from(collectSelfCheckInRequests)
    .where(and(eq(collectSelfCheckInRequests.eventId, eventId), eq(collectSelfCheckInRequests.status, "pending")))
    .orderBy(asc(collectSelfCheckInRequests.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, kana: r.kana, createdAt: r.createdAt.toISOString() }));
}

/**
 * 参加者が飛び入りとして申し出る（端末ごとに待ちは1件・リンク全体の待ちは30件まで）。
 * @param databaseUrl - 接続文字列
 * @param link - 使えるリンク
 * @param deviceHash - 端末の印のハッシュ
 * @param input - 名前とふりがな
 * @returns 申し出の番号・新しい版・待ちの申し出（知らせのため）
 * @throws AppError REQUEST_PENDING（409）・RATE_LIMITED（429）
 */
export async function createRequest(
  databaseUrl: string,
  link: SelfLinkRow,
  deviceHash: string,
  input: SelfRequestCreate,
): Promise<{ requestId: string; version: number; requests: SelfRequest[] }> {
  try {
    return await withTransaction(databaseUrl, async (tx) => {
      await tx.select({ id: collectEvents.id }).from(collectEvents).where(eq(collectEvents.id, link.eventId)).for("update");
      const [pending] = await tx
        .select({ n: count() })
        .from(collectSelfCheckInRequests)
        .where(and(eq(collectSelfCheckInRequests.linkId, link.id), eq(collectSelfCheckInRequests.status, "pending")));
      if (Number(pending?.n ?? 0) >= SELF_CHECK_IN_LIMITS.pendingRequestsPerLink) throw new AppError("RATE_LIMITED", 429, "too many pending requests");
      const [row] = await tx
        .insert(collectSelfCheckInRequests)
        .values({ eventId: link.eventId, linkId: link.id, name: input.name, nameKey: nameKey(input.name), kana: input.kana, deviceHash })
        .returning({ id: collectSelfCheckInRequests.id });
      return { requestId: row!.id, version: await bump(tx, link.eventId), requests: await pendingRequests(tx, link.eventId) };
    });
  } catch (err) {
    // 同じ端末の待ちがある（部分一意索引）
    if (pgErrorCode(err) === "23505") throw new AppError("REQUEST_PENDING", 409, "request pending");
    throw err;
  }
}

/**
 * 待ちの申し出を引く（ロックつき）。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param requestId - 申し出の番号
 * @returns 申し出
 * @throws AppError ITEM_NOT_FOUND・REQUEST_RESOLVED
 */
async function pendingRequestOf(tx: TxDb, eventId: string, requestId: string) {
  if (!isUuid(requestId)) throw new AppError("ITEM_NOT_FOUND", 404, "request not found");
  const [row] = await tx
    .select()
    .from(collectSelfCheckInRequests)
    .where(and(eq(collectSelfCheckInRequests.id, requestId), eq(collectSelfCheckInRequests.eventId, eventId)))
    .limit(1);
  if (!row) throw new AppError("ITEM_NOT_FOUND", 404, "request not found");
  if (row.status !== "pending") throw new AppError("REQUEST_RESOLVED", 409, "request resolved");
  return row;
}

/** 申し出を片付けた結果。 */
type Resolved = { version: number; requests: SelfRequest[]; person?: ReceptionPerson };

/**
 * 申し出を名簿に入れる（001 の飛び入りと同じ：媒体「当日」・最初の区分・次の受付番号）。
 * @param databaseUrl - 接続文字列
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @param requestId - 申し出の番号
 * @returns 新しい版・待ちの申し出・名簿に入れた人
 */
export async function acceptRequest(databaseUrl: string, actor: ReceptionActor, eventId: string, requestId: string): Promise<Resolved> {
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadActorEvent(tx, actor, eventId, { forUpdate: true });
    const request = await pendingRequestOf(tx, event.id, requestId);
    const [tier] = await tx.select({ id: collectPriceTiers.id }).from(collectPriceTiers).where(eq(collectPriceTiers.eventId, event.id)).orderBy(asc(collectPriceTiers.position)).limit(1);
    if (!tier) throw new AppError("VALIDATION_FAILED", 400, "event has no tier", undefined, ["priceTierId"]);
    const [numbered] = await tx
      .update(collectEvents)
      .set({ nextNumber: sql`${collectEvents.nextNumber} + 1`, updatedAt: new Date() })
      .where(eq(collectEvents.id, event.id))
      .returning({ next: collectEvents.nextNumber });
    const [person] = await tx
      .insert(collectRosterPeople)
      .values({
        eventId: event.id,
        number: numbered!.next - 1,
        name: request.name,
        nameKey: request.nameKey,
        kana: request.kana,
        kanaKey: request.kana ? nameKey(request.kana) : null,
        media: "walk_in",
        priceTierId: tier.id,
        addedByHelperId: actor.kind === "helper" ? actor.helperId : null,
      })
      .returning();
    await tx
      .update(collectSelfCheckInRequests)
      .set({ status: "accepted", rosterPersonId: person!.id, resolvedAt: new Date() })
      .where(eq(collectSelfCheckInRequests.id, request.id));
    return { version: await bump(tx, event.id), requests: await pendingRequests(tx, event.id), person: toReceptionPerson(person!, false) };
  });
}

/**
 * 申し出を名簿の人に当てる（つづり違い・旧姓など）。
 * @param databaseUrl - 接続文字列
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @param requestId - 申し出の番号
 * @param personId - 当てる名簿の人
 * @returns 新しい版・待ちの申し出
 */
export async function matchRequest(databaseUrl: string, actor: ReceptionActor, eventId: string, requestId: string, personId: string): Promise<Resolved> {
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadActorEvent(tx, actor, eventId, { forUpdate: true });
    const request = await pendingRequestOf(tx, event.id, requestId);
    const [person] = await tx
      .select({ id: collectRosterPeople.id })
      .from(collectRosterPeople)
      .where(and(eq(collectRosterPeople.id, personId), eq(collectRosterPeople.eventId, event.id)))
      .limit(1);
    if (!person) throw new AppError("VALIDATION_FAILED", 400, "unknown person", undefined, ["personId"]);
    await tx
      .update(collectSelfCheckInRequests)
      .set({ status: "matched", rosterPersonId: person.id, resolvedAt: new Date() })
      .where(eq(collectSelfCheckInRequests.id, request.id));
    return { version: await bump(tx, event.id), requests: await pendingRequests(tx, event.id) };
  });
}

/**
 * 申し出を断る。
 * @param databaseUrl - 接続文字列
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @param requestId - 申し出の番号
 * @returns 新しい版・待ちの申し出
 */
export async function rejectRequest(databaseUrl: string, actor: ReceptionActor, eventId: string, requestId: string): Promise<Resolved> {
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadActorEvent(tx, actor, eventId, { forUpdate: true });
    const request = await pendingRequestOf(tx, event.id, requestId);
    await tx.update(collectSelfCheckInRequests).set({ status: "rejected", resolvedAt: new Date() }).where(eq(collectSelfCheckInRequests.id, request.id));
    return { version: await bump(tx, event.id), requests: await pendingRequests(tx, event.id) };
  });
}

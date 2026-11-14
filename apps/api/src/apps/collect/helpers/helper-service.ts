// 手伝う人（specs/collect/001-event-day-collection contracts/api.md 5・8、FR-071・FR-072・FR-075、research.md R7、tasks.md T048）。
// 手伝う人はログインしない。受付用リンク（道筋の :token）と端末の印（見出し X-Collect-Device）で確かめる。
// 端末の印は32バイトの乱数で、DBにはハッシュだけを持つ。同じ名前（nameKey が同じ）の人がいたら 409 HELPER_NAME_TAKEN を返し、
// 画面が「同じ人ですか？」と聞いて、同じ人なら sameAsHelperId（その人に端末を足す）、別の人なら asNew で送り直す。
import { nameKey, type HelperJoinRequest, type HelperLinkInfo, type ReceptionHelper, type ReceptionWorkersResponse } from "@meguru/shared";
import { and, asc, count, eq, lt, max, sql, sum } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { sha256Hex } from "../../../kernel/identifier-hash";
import { newInviteToken } from "../../../kernel/invite-token";
import { loadOwnedEvent, type ReceptionActor } from "../access";
import { listReceptionHelpers } from "../reception/reception-service";
import { collectEvents, collectHelperDevices, collectHelpers, collectReceptionLinks, collectReceptionRecords } from "../schema";

type LinkRow = typeof collectReceptionLinks.$inferSelect;

/**
 * ない受付用リンク。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
const linkNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "link not found");

/**
 * トークンから受付用リンクを引く。
 * @param db - データベース
 * @param token - 道筋の :token
 * @returns リンクの行
 */
async function linkByToken(db: Db | TxDb, token: string): Promise<LinkRow | undefined> {
  if (!token.startsWith("cr_") || token.length > 100) return undefined;
  // 手伝う人の道筋は、手伝う人の受付用リンクだけを受ける（セルフ受付のリンクでは入れない。specs/collect/002 research.md R1）
  const [row] = await db
    .select()
    .from(collectReceptionLinks)
    .where(and(eq(collectReceptionLinks.tokenHash, await sha256Hex(token)), eq(collectReceptionLinks.kind, "helper")))
    .limit(1);
  return row;
}

/**
 * リンクの状態。
 * @param link - リンクの行
 * @param now - 今
 * @returns active・stopped・expired
 */
function linkStatus(link: LinkRow, now: Date): HelperLinkInfo["status"] {
  if (link.stoppedAt) return "stopped";
  return link.expiresAt > now ? "active" : "expired";
}

/**
 * 使えるリンクを引く。
 * @param db - データベース
 * @param token - 道筋の :token
 * @param now - 今
 * @returns リンクの行
 * @throws AppError ITEM_NOT_FOUND（ない）・LINK_INACTIVE（止めた・期限が過ぎた。410）
 */
async function activeLink(db: Db | TxDb, token: string, now: Date): Promise<LinkRow> {
  const link = await linkByToken(db, token);
  if (!link) throw linkNotFound();
  if (linkStatus(link, now) !== "active") throw new AppError("LINK_INACTIVE", 410, "link inactive");
  return link;
}

/**
 * リンクを開いた画面に出すもの（GET /api/collect/r/:token）。
 * @param db - データベース
 * @param token - 道筋の :token
 * @param now - 今
 * @returns 状態・イベント・期限
 * @throws AppError ITEM_NOT_FOUND
 */
export async function linkInfo(db: Db, token: string, now: Date): Promise<HelperLinkInfo> {
  const link = await linkByToken(db, token);
  if (!link) throw linkNotFound();
  const [event] = await db
    .select({ name: collectEvents.name, startsAt: collectEvents.startsAt, venue: collectEvents.venue })
    .from(collectEvents)
    .where(eq(collectEvents.id, link.eventId))
    .limit(1);
  if (!event) throw linkNotFound();
  return {
    status: linkStatus(link, now),
    event: { name: event.name, startsAt: event.startsAt.toISOString(), venue: event.venue },
    expiresAt: link.expiresAt.toISOString(),
  };
}

/**
 * 受付をする手伝う人を確かめる（リンク → 端末の印）。端末の最後に使った時刻を直す（1分ごと）。
 * @param db - データベース
 * @param token - 道筋の :token
 * @param deviceSecret - 見出し X-Collect-Device の値
 * @param now - 今
 * @returns 受付をする人（手伝う人）
 * @throws AppError ITEM_NOT_FOUND・LINK_INACTIVE（410）・DEVICE_REQUIRED（401。印がない・合わない・ほかのリンクの印）
 */
export async function loadHelperActor(db: Db, token: string, deviceSecret: string | undefined, now: Date): Promise<ReceptionActor & { kind: "helper" }> {
  const link = await activeLink(db, token, now);
  if (!deviceSecret || deviceSecret.length > 100) throw new AppError("DEVICE_REQUIRED", 401, "device required");
  const [device] = await db
    .select({ id: collectHelperDevices.id, helperId: collectHelpers.id })
    .from(collectHelperDevices)
    .innerJoin(collectHelpers, eq(collectHelpers.id, collectHelperDevices.helperId))
    .where(and(eq(collectHelperDevices.secretHash, await sha256Hex(deviceSecret)), eq(collectHelpers.linkId, link.id)))
    .limit(1);
  if (!device) throw new AppError("DEVICE_REQUIRED", 401, "device required");
  // 最後に使った時刻は、1分より古いときだけ書く（記録のたびに書き込みを増やさない）
  await db
    .update(collectHelperDevices)
    .set({ lastSeenAt: now })
    .where(and(eq(collectHelperDevices.id, device.id), lt(collectHelperDevices.lastSeenAt, new Date(now.getTime() - 60_000))));
  return { kind: "helper", helperId: device.helperId, eventId: link.eventId };
}

/**
 * 手伝う人が名前を入れて参加する（POST /api/collect/r/:token/join。FR-071・FR-075）。
 * @param databaseUrl - 接続文字列
 * @param token - 道筋の :token
 * @param input - 検証済みの入力
 * @param now - 今
 * @returns 手伝う人の番号・端末の印・イベント・新しい版・手伝う人の一覧（知らせのため）
 * @throws AppError ITEM_NOT_FOUND・LINK_INACTIVE・HELPER_NAME_TAKEN（helperId・joinedAt）・VALIDATION_FAILED（sameAsHelperId が違う）
 */
export async function joinHelper(
  databaseUrl: string,
  token: string,
  input: HelperJoinRequest,
  now: Date,
): Promise<{ helperId: string; deviceSecret: string; eventId: string; version: number; helpers: ReceptionHelper[] }> {
  return withTransaction(databaseUrl, async (tx) => {
    const link = await activeLink(tx, token, now);
    // 同じ名前の確かめと作るのを1つずつにする（イベントの行のロック）
    await tx.select({ id: collectEvents.id }).from(collectEvents).where(eq(collectEvents.id, link.eventId)).for("update");
    const key = nameKey(input.name);
    let helperId: string;
    if (input.sameAsHelperId) {
      const [same] = await tx
        .select({ id: collectHelpers.id })
        .from(collectHelpers)
        .where(and(eq(collectHelpers.id, input.sameAsHelperId), eq(collectHelpers.linkId, link.id), eq(collectHelpers.nameKey, key)))
        .limit(1);
      if (!same) throw new AppError("VALIDATION_FAILED", 400, "unknown helper", undefined, ["sameAsHelperId"]);
      helperId = same.id;
    } else {
      if (!input.asNew) {
        const [taken] = await tx
          .select({ id: collectHelpers.id, joinedAt: collectHelpers.joinedAt })
          .from(collectHelpers)
          .where(and(eq(collectHelpers.linkId, link.id), eq(collectHelpers.nameKey, key)))
          .orderBy(asc(collectHelpers.joinedAt))
          .limit(1);
        if (taken) {
          throw new AppError("HELPER_NAME_TAKEN", 409, "helper name taken", undefined, undefined, {
            helperId: taken.id,
            joinedAt: taken.joinedAt.toISOString(),
          });
        }
      }
      const [created] = await tx
        .insert(collectHelpers)
        .values({ eventId: link.eventId, linkId: link.id, name: input.name, nameKey: key, joinedAt: now })
        .returning({ id: collectHelpers.id });
      helperId = created!.id;
    }
    const deviceSecret = newInviteToken("cd_");
    await tx.insert(collectHelperDevices).values({ helperId, secretHash: await sha256Hex(deviceSecret), createdAt: now, lastSeenAt: now });
    const [bumped] = await tx
      .update(collectEvents)
      .set({ version: sql`${collectEvents.version} + 1`, updatedAt: now })
      .where(eq(collectEvents.id, link.eventId))
      .returning({ version: collectEvents.version });
    return { helperId, deviceSecret, eventId: link.eventId, version: bumped!.version, helpers: await listReceptionHelpers(tx, link.eventId) };
  });
}

/**
 * 受付をしている人の一覧（GET …/helpers。FR-072）：手伝う人ごとの件数・受け取った現金・最後の記録・端末の数と、主催者自身の行。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns 一覧
 */
export async function listWorkers(db: Db, ownerUserId: string, eventId: string): Promise<ReceptionWorkersResponse> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const [helpers, byReceiver, devices] = await Promise.all([
    db.select().from(collectHelpers).where(eq(collectHelpers.eventId, event.id)).orderBy(asc(collectHelpers.joinedAt)),
    db
      .select({
        kind: collectReceptionRecords.receiverKind,
        helperId: collectReceptionRecords.receiverHelperId,
        n: count(),
        cash: sum(sql`CASE WHEN ${collectReceptionRecords.method} = 'cash' THEN ${collectReceptionRecords.amount} ELSE 0 END`).mapWith(Number),
        last: max(collectReceptionRecords.recordedAt),
      })
      .from(collectReceptionRecords)
      .where(eq(collectReceptionRecords.eventId, event.id))
      .groupBy(collectReceptionRecords.receiverKind, collectReceptionRecords.receiverHelperId),
    db
      .select({ helperId: collectHelperDevices.helperId, n: count() })
      .from(collectHelperDevices)
      .innerJoin(collectHelpers, eq(collectHelpers.id, collectHelperDevices.helperId))
      .where(eq(collectHelpers.eventId, event.id))
      .groupBy(collectHelperDevices.helperId),
  ]);
  const owner = byReceiver.find((r) => r.kind === "owner");
  const helperStats = new Map(byReceiver.filter((r) => r.helperId).map((r) => [r.helperId!, r]));
  const deviceCount = new Map(devices.map((d) => [d.helperId, Number(d.n)]));
  return {
    owner: { lastRecordedAt: owner?.last?.toISOString() ?? null, recordCount: Number(owner?.n ?? 0), cashAmount: owner?.cash ?? 0 },
    helpers: helpers.map((h) => {
      const s = helperStats.get(h.id);
      return {
        id: h.id,
        name: h.name,
        joinedAt: h.joinedAt.toISOString(),
        lastRecordedAt: s?.last?.toISOString() ?? null,
        recordCount: Number(s?.n ?? 0),
        cashAmount: s?.cash ?? 0,
        deviceCount: deviceCount.get(h.id) ?? 0,
      };
    }),
  };
}

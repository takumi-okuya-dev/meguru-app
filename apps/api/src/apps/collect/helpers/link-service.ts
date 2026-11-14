// 受付用リンク（specs/collect/001-event-day-collection contracts/api.md 5、FR-070・FR-073、research.md R7、tasks.md T047）。
// トークンは32バイトの乱数（頭に cr_）。DBにはハッシュ（引くため）と暗号文（主催者があとでQRを出し直すため。AADはイベントの番号）を持つ。
// 使えるリンク（止めていないもの）はイベントに1つ。止めたら stopped_at を入れ、出し直すと新しい行になる（前のトークンは使えない）。
import type { ReceptionLink } from "@meguru/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createDb, withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError } from "../../../kernel/errors";
import { inviteUrl, newInviteToken, openInviteToken, sealInviteToken } from "../../../kernel/invite-token";
import { loadOwnedEvent, type CollectEventRow } from "../access";
import { collectEvents, collectReceptionLinks } from "../schema";

type LinkRow = typeof collectReceptionLinks.$inferSelect;

/** リンクの種類：helper＝手伝う人の受付用リンク（001）、self＝参加者のセルフ受付（specs/collect/002 research.md R1）。 */
export type LinkKind = "helper" | "self";

/** 種類ごとの画面のパスとトークンの頭。 */
const KIND: Record<LinkKind, { route: string; prefix: string }> = {
  helper: { route: "collect/r", prefix: "cr_" },
  self: { route: "collect/s", prefix: "cs_" },
};
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * 期限の既定（R7）：開催日の日本時間23:59:59と、終わりの時刻（なければ開始の時刻）の1時間後の、遅い方。
 * 日付をまたぐイベント（19:00〜翌1:00）でも途中で切れない（翌2:00）。
 * @param event - イベント
 * @returns 期限
 */
export function defaultLinkExpiry(event: Pick<CollectEventRow, "startsAt" | "endsAt">): Date {
  const jst = new Date(event.startsAt.getTime() + JST_OFFSET_MS);
  const endOfDay = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 23, 59, 59) - JST_OFFSET_MS);
  const afterEnd = new Date((event.endsAt ?? event.startsAt).getTime() + HOUR_MS);
  return endOfDay > afterEnd ? endOfDay : afterEnd;
}

/**
 * リンクの行を応答の形にする（暗号文からトークンを戻してURLにする）。
 * @param env - Workers のバインディング
 * @param row - reception_links の行
 * @returns リンク
 */
async function toLink(env: Env, row: LinkRow): Promise<ReceptionLink> {
  const token = await openInviteToken(env, { ciphertext: row.tokenCiphertext, iv: row.tokenIv, keyVersion: row.tokenKeyVersion }, row.eventId);
  return { url: inviteUrl(env, token, KIND[row.kind as LinkKind].route), expiresAt: row.expiresAt.toISOString(), stoppedAt: row.stoppedAt?.toISOString() ?? null };
}

/**
 * イベントの使えるリンク（止めていないもの。期限が過ぎていても返す）。
 * @param db - データベース
 * @param eventId - イベントの番号
 * @param kind - リンクの種類
 * @returns リンクの行
 */
async function activeLinkRow(db: Db | TxDb, eventId: string, kind: LinkKind): Promise<LinkRow | undefined> {
  const [row] = await db
    .select()
    .from(collectReceptionLinks)
    .where(and(eq(collectReceptionLinks.eventId, eventId), eq(collectReceptionLinks.kind, kind), isNull(collectReceptionLinks.stoppedAt)))
    .limit(1);
  return row;
}

/**
 * 期限が今より後かを確かめる。
 * @param expiresAt - 期限
 * @param now - 今
 * @throws AppError VALIDATION_FAILED
 */
function assertFuture(expiresAt: Date, now: Date): void {
  if (expiresAt.getTime() <= now.getTime()) throw new AppError("VALIDATION_FAILED", 400, "expiresAt must be in the future", undefined, ["expiresAt"]);
}

/**
 * 今のリンク（GET …/link）。ない・止めたあとなら null。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param kind - リンクの種類（既定は手伝う人の受付用リンク）
 * @returns リンク
 */
export async function getLink(env: Env, db: Db, ownerUserId: string, eventId: string, kind: LinkKind = "helper"): Promise<ReceptionLink | null> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const row = await activeLinkRow(db, event.id, kind);
  return row ? toLink(env, row) : null;
}

/**
 * リンクを出す（POST …/link）。使えるリンクがあればそれを返す。期限が過ぎたリンクは止めてから、新しいリンクを出す。
 * @param env - Workers のバインディング
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param expiresAt - 期限（省いたら既定）
 * @param now - 今
 * @param kind - リンクの種類（既定は手伝う人の受付用リンク）
 * @returns リンク
 */
export async function createLink(
  env: Env,
  ownerUserId: string,
  eventId: string,
  expiresAt: Date | undefined,
  now: Date,
  kind: LinkKind = "helper",
): Promise<ReceptionLink> {
  if (expiresAt) assertFuture(expiresAt, now);
  const row = await withTransaction(env.DATABASE_URL, async (tx) => {
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    const current = await activeLinkRow(tx, event.id, kind);
    if (current && current.expiresAt > now) return current;
    if (current) await tx.update(collectReceptionLinks).set({ stoppedAt: now }).where(eq(collectReceptionLinks.id, current.id));
    const token = newInviteToken(KIND[kind].prefix);
    const sealed = await sealInviteToken(env, token, event.id);
    const [created] = await tx
      .insert(collectReceptionLinks)
      .values({
        eventId: event.id,
        tokenHash: sealed.hash,
        tokenCiphertext: sealed.ciphertext,
        tokenIv: sealed.iv,
        tokenKeyVersion: sealed.keyVersion,
        expiresAt: expiresAt ?? defaultLinkExpiry(event),
        kind,
      })
      .returning();
    return created!;
  });
  return toLink(env, row);
}

/**
 * 期限を変える（PATCH …/link）。
 * @param env - Workers のバインディング
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param expiresAt - 新しい期限
 * @param now - 今
 * @param kind - リンクの種類（既定は手伝う人の受付用リンク）
 * @returns リンク
 * @throws AppError ITEM_NOT_FOUND（使えるリンクがない）
 */
export async function updateLinkExpiry(
  env: Env,
  ownerUserId: string,
  eventId: string,
  expiresAt: Date,
  now: Date,
  kind: LinkKind = "helper",
): Promise<ReceptionLink> {
  assertFuture(expiresAt, now);
  const db = createDb(env.DATABASE_URL);
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const [row] = await db
    .update(collectReceptionLinks)
    .set({ expiresAt })
    .where(and(eq(collectReceptionLinks.eventId, event.id), eq(collectReceptionLinks.kind, kind), isNull(collectReceptionLinks.stoppedAt)))
    .returning();
  if (!row) throw new AppError("ITEM_NOT_FOUND", 404, "no active link");
  return toLink(env, row);
}

/**
 * リンクを止める（POST …/link/stop。FR-073）。受付の画面に関わる変更なので版を上げる（呼ぶ側が link.stopped を知らせる）。
 * 手伝う人の記録は残る。
 * @param databaseUrl - 接続文字列
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param now - 今
 * @param kind - リンクの種類（既定は手伝う人の受付用リンク）
 * @returns 新しい版
 * @throws AppError ITEM_NOT_FOUND（使えるリンクがない）
 */
export async function stopLink(databaseUrl: string, ownerUserId: string, eventId: string, now: Date, kind: LinkKind = "helper"): Promise<{ version: number }> {
  return withTransaction(databaseUrl, async (tx) => {
    const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    const stopped = await tx
      .update(collectReceptionLinks)
      .set({ stoppedAt: now })
      .where(and(eq(collectReceptionLinks.eventId, event.id), eq(collectReceptionLinks.kind, kind), isNull(collectReceptionLinks.stoppedAt)))
      .returning({ id: collectReceptionLinks.id });
    if (stopped.length === 0) throw new AppError("ITEM_NOT_FOUND", 404, "no active link");
    const [row] = await tx
      .update(collectEvents)
      .set({ version: sql`${collectEvents.version} + 1`, updatedAt: now })
      .where(eq(collectEvents.id, event.id))
      .returning({ version: collectEvents.version });
    return { version: row!.version };
  });
}

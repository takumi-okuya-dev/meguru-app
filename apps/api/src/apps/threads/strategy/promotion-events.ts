// 宣伝内容のイベントの情報を、ほかのアプリ（集金管理）に出来事で伝える（specs/collect/001-event-day-collection contracts/events.md 2、
// docs/module-map.md 1-4）。Threads は宣伝内容を変えるのと同じトランザクションで出来事を書き、トランザクションのあとで届ける。
// 受け取るアプリがまだない（入っていない）こともあるので、届け先がなければ何も書かない（allowNoConsumers）。
// 中身に入れるのは、受け取る側が候補として写すのに要る値だけ（宣伝の本文・ターゲットなどは入れない）。
import type { PromotionEvent } from "@meguru/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db, TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { logger } from "../../../kernel/logger";
import { deliverPendingEvents, emitEvent } from "../../../platform";
import { promotionListings, promotions } from "../schema";

type PromotionRow = typeof promotions.$inferSelect;

/**
 * 画面の日時（日本時間の「YYYY-MM-DDTHH:mm」）を ISO 8601 にする。
 * @param local - 「2026-11-20T19:00」
 * @returns 「2026-11-20T10:00:00.000Z」
 */
export function jstLocalToIso(local: string): string {
  return new Date(`${local}:00+09:00`).toISOString();
}

/**
 * 会場の表示（会場の名前。なければ都道府県と住所。オンラインならオンライン）。
 * @param e - イベントの情報
 * @returns 会場（なければ null）
 */
function venueOf(e: PromotionEvent): string | null {
  if (e.venueName) return e.venueName;
  const place = [e.prefecture, e.address].filter(Boolean).join("");
  if (place) return place;
  return e.format === "online" ? "オンライン" : null;
}

/**
 * 宣伝内容のイベントの情報が変わったことを書く。イベントの情報（開催日時）があれば「保存した」、前はあって今はない
 * （消した・宣伝内容を消した）なら「消した」。どちらもなければ何もしない。
 * @param tx - 宣伝内容を変えたトランザクション
 * @param before - 変える前のイベントの情報（新しく作ったときは null）
 * @param after - 変えたあとの宣伝内容の行（消したときは null）
 * @param ctx - promotionId・threadsAccountId（accounts.id）・ownerUserId（アカウントの持ち主）・now
 * @returns 書いた出来事の番号（書かなかったら空）
 */
export async function emitPromotionEventChange(
  tx: Db | TxDb,
  before: PromotionEvent | null,
  after: Pick<PromotionRow, "title" | "event"> | null,
  ctx: { promotionId: string; threadsAccountId: string; ownerUserId: string; now: Date },
): Promise<string[]> {
  const occurredAt = ctx.now.toISOString();
  const e = after?.event ?? null;
  if (after && e) {
    const id = await emitEvent(
      tx,
      "threads.promotion_event.saved",
      {
        promotionId: ctx.promotionId,
        threadsAccountId: ctx.threadsAccountId,
        ownerUserId: ctx.ownerUserId,
        name: after.title,
        startsAt: jstLocalToIso(e.startAt),
        endsAt: e.endAt ? jstLocalToIso(e.endAt) : null,
        venue: venueOf(e),
        capacity: e.capacity,
        feeAmount: e.feeYen,
        feeNote: e.feeNote,
        occurredAt,
      },
      { allowNoConsumers: true },
    );
    return id ? [id] : [];
  }
  if (!before) return [];
  const id = await emitEvent(tx, "threads.promotion_event.deleted", { promotionId: ctx.promotionId, occurredAt }, { allowNoConsumers: true });
  return id ? [id] : [];
}

/**
 * 外部媒体の掲載の状況が変わったことを書く（掲載済みの媒体の一覧。Threads の媒体の名前のまま）。
 * @param tx - 掲載の状況を変えたトランザクション
 * @param promotionId - 宣伝内容の番号
 * @param now - 今
 * @returns 書いた出来事の番号（書かなかったら空）
 */
export async function emitListingStatusChange(tx: Db | TxDb, promotionId: string, now: Date): Promise<string[]> {
  const rows = await tx
    .select({ media: promotionListings.media })
    .from(promotionListings)
    .where(and(eq(promotionListings.promotionId, promotionId), eq(promotionListings.status, "posted")));
  const id = await emitEvent(
    tx,
    "threads.listing_status.changed",
    { promotionId, postedMedia: rows.map((r) => r.media).sort(), occurredAt: now.toISOString() },
    { allowNoConsumers: true },
  );
  return id ? [id] : [];
}

/**
 * アカウントを消す前に、そのアカウントのイベントの情報のある宣伝内容を「消した」と書く（宣伝内容は CASCADE で消える）。
 * @param tx - アカウントを消すトランザクション
 * @param accountId - accounts.id
 * @param now - 今
 * @returns 書いた出来事の番号
 */
export async function emitPromotionEventsDeletedForAccount(tx: Db | TxDb, accountId: string, now: Date): Promise<string[]> {
  const rows = await tx
    .select({ id: promotions.id })
    .from(promotions)
    .where(and(eq(promotions.accountId, accountId), isNotNull(promotions.event)));
  const ids: string[] = [];
  for (const r of rows) {
    const id = await emitEvent(tx, "threads.promotion_event.deleted", { promotionId: r.id, occurredAt: now.toISOString() }, { allowNoConsumers: true });
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * 書いた出来事を、トランザクションのあとですぐ届ける（届かなければ5分ごとの届けがやり直す）。失敗しても元の操作は成功のまま。
 * @param env - Workers のバインディング
 * @param eventIds - 書いた出来事の番号
 */
export async function deliverPromotionEvents(env: Env, eventIds: readonly string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await deliverPendingEvents(env, new Date(), { eventIds }).catch((err: unknown) =>
    logger.warn("threads promotion events: delivery deferred", { err: String(err), count: eventIds.length }),
  );
}

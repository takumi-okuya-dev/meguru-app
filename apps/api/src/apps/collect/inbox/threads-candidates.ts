// Threads の出来事を受け取って、イベントの候補に写す（specs/collect/001-event-day-collection contracts/events.md 2・3、research.md R15、tasks.md T076）。
// - 出来事の番号を received_events に書いてから処理し、同じ番号は何もしない（2回届いても同じ結果）。
// - 順番が入れ替わって届くので、イベントの情報と掲載の状況のそれぞれで、持っている「起きた時刻」より古い出来事は捨てる。
// - 候補から作ったイベントは、元が直されたら source_changed_at、消されたら source_deleted_at を付ける（イベントの中身は変えない。FR-063）。
// - 掲載済みの媒体は、Threads の媒体の名前を集金管理の媒体の値に直す（知らない名前は捨てる）。
import { collectMediaFromThreads, type CollectMedia } from "@meguru/shared";
import { and, eq, lt, or, isNull } from "drizzle-orm";
import { withTransaction, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import type { PlatformEvent } from "../../../platform";
import { collectEvents, collectReceivedEvents, collectThreadsEventCandidates } from "../schema";

/**
 * 受け取った出来事の番号を記録する。もう記録していれば false（何もしない）。
 * @param tx - 集金管理のトランザクション
 * @param eventId - 出来事の番号
 * @returns 初めて受け取ったなら true
 */
async function markReceived(tx: TxDb, eventId: string): Promise<boolean> {
  const rows = await tx.insert(collectReceivedEvents).values({ eventId }).onConflictDoNothing().returning({ eventId: collectReceivedEvents.eventId });
  return rows.length > 0;
}

/**
 * 宣伝内容のイベントの情報を保存した：候補に書く（あれば、より新しいときだけ上書きし、消された印を外す）。
 * そこから作ったイベントがあれば「元が変わった」を付ける。
 * @param event - 出来事
 * @param env - Workers のバインディング
 */
export async function onPromotionEventSaved(event: PlatformEvent<"threads.promotion_event.saved">, env: Env): Promise<void> {
  const p = event.payload;
  const occurredAt = new Date(p.occurredAt);
  await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return;
    const values = {
      threadsAccountId: p.threadsAccountId,
      ownerUserId: p.ownerUserId,
      name: p.name,
      startsAt: new Date(p.startsAt),
      endsAt: p.endsAt ? new Date(p.endsAt) : null,
      venue: p.venue,
      capacity: p.capacity,
      feeAmount: p.feeAmount,
      feeNote: p.feeNote,
      deletedAt: null,
      detailsOccurredAt: occurredAt,
    };
    const written = await tx
      .insert(collectThreadsEventCandidates)
      .values({ promotionId: p.promotionId, ...values })
      .onConflictDoUpdate({
        target: collectThreadsEventCandidates.promotionId,
        set: values,
        setWhere: lt(collectThreadsEventCandidates.detailsOccurredAt, occurredAt),
      })
      .returning({ promotionId: collectThreadsEventCandidates.promotionId });
    if (written.length === 0) return;
    // 候補から作ったあとで元が直されたイベントに印（作る前の保存では付けない）
    await tx
      .update(collectEvents)
      .set({ sourceChangedAt: occurredAt })
      .where(and(eq(collectEvents.sourceThreadsPromotionId, p.promotionId), lt(collectEvents.createdAt, occurredAt)));
  });
}

/**
 * 宣伝内容のイベントの情報を消した：候補に消された印を付け、そこから作ったイベントに「元が消された」を付ける。
 * @param event - 出来事
 * @param env - Workers のバインディング
 */
export async function onPromotionEventDeleted(event: PlatformEvent<"threads.promotion_event.deleted">, env: Env): Promise<void> {
  const { promotionId } = event.payload;
  const occurredAt = new Date(event.payload.occurredAt);
  await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return;
    const marked = await tx
      .update(collectThreadsEventCandidates)
      .set({ deletedAt: occurredAt, detailsOccurredAt: occurredAt })
      .where(and(eq(collectThreadsEventCandidates.promotionId, promotionId), lt(collectThreadsEventCandidates.detailsOccurredAt, occurredAt)))
      .returning({ promotionId: collectThreadsEventCandidates.promotionId });
    if (marked.length === 0) return;
    await tx
      .update(collectEvents)
      .set({ sourceDeletedAt: occurredAt })
      .where(and(eq(collectEvents.sourceThreadsPromotionId, promotionId), isNull(collectEvents.sourceDeletedAt)));
  });
}

/**
 * 外部媒体の掲載の状況を変えた：候補の掲載済みの媒体を書き換える（まだ候補がなければ何もしない）。
 * @param event - 出来事
 * @param env - Workers のバインディング
 */
export async function onListingStatusChanged(event: PlatformEvent<"threads.listing_status.changed">, env: Env): Promise<void> {
  const { promotionId, postedMedia } = event.payload;
  const occurredAt = new Date(event.payload.occurredAt);
  const media = [...new Set(postedMedia.flatMap((m) => collectMediaFromThreads(m) ?? []))] as CollectMedia[];
  await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return;
    await tx
      .update(collectThreadsEventCandidates)
      .set({ postedMedia: media, mediaOccurredAt: occurredAt })
      .where(
        and(
          eq(collectThreadsEventCandidates.promotionId, promotionId),
          or(isNull(collectThreadsEventCandidates.mediaOccurredAt), lt(collectThreadsEventCandidates.mediaOccurredAt, occurredAt)),
        ),
      );
  });
}

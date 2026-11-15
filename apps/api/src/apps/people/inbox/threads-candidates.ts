// Threads の出来事を受け取って、イベントの候補に写す（specs/people/003-threads-event-candidates plan.md R1）。
// - 出来事の番号を received_events に書いてから処理し、同じ番号は何もしない（2回届いても同じ結果）。
// - 順番が入れ替わって届くので、持っている「起きた時刻」より古い出来事は捨てる。
// - 写すのは、人物メモのイベントを作るのに要る値（名前・開始の時刻）だけ。Threads の表は読まない（パターン①）。
// - 候補から作ったイベントは、Threads の変更に合わせて変えない（FR-007）。
import { and, eq, lt } from "drizzle-orm";
import { withTransaction, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import type { PlatformEvent } from "../../../platform";
import { peopleReceivedEvents, peopleThreadsEventCandidates } from "../schema";

/**
 * 受け取った出来事の番号を記録する。もう記録していれば false（何もしない）。
 * @param tx - 人物メモのトランザクション
 * @param eventId - 出来事の番号
 * @returns 初めて受け取ったなら true
 */
async function markReceived(tx: TxDb, eventId: string): Promise<boolean> {
  const rows = await tx.insert(peopleReceivedEvents).values({ eventId }).onConflictDoNothing().returning({ eventId: peopleReceivedEvents.eventId });
  return rows.length > 0;
}

/**
 * 宣伝内容のイベントの情報を保存した：候補に書く（あれば、より新しいときだけ上書きし、消された印を外す）。
 * @param event - 出来事
 * @param env - Workers のバインディング
 */
export async function onPromotionEventSaved(event: PlatformEvent<"threads.promotion_event.saved">, env: Env): Promise<void> {
  const p = event.payload;
  const occurredAt = new Date(p.occurredAt);
  await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return;
    const values = { userId: p.ownerUserId, name: p.name, startsAt: new Date(p.startsAt), deletedAt: null, detailsOccurredAt: occurredAt };
    await tx
      .insert(peopleThreadsEventCandidates)
      .values({ promotionId: p.promotionId, ...values })
      .onConflictDoUpdate({
        target: peopleThreadsEventCandidates.promotionId,
        set: values,
        setWhere: lt(peopleThreadsEventCandidates.detailsOccurredAt, occurredAt),
      });
  });
}

/**
 * 宣伝内容のイベントの情報を消した：候補に消された印を付ける（候補から作ったイベントはそのまま）。
 * @param event - 出来事
 * @param env - Workers のバインディング
 */
export async function onPromotionEventDeleted(event: PlatformEvent<"threads.promotion_event.deleted">, env: Env): Promise<void> {
  const { promotionId } = event.payload;
  const occurredAt = new Date(event.payload.occurredAt);
  await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return;
    await tx
      .update(peopleThreadsEventCandidates)
      .set({ deletedAt: occurredAt, detailsOccurredAt: occurredAt })
      .where(and(eq(peopleThreadsEventCandidates.promotionId, promotionId), lt(peopleThreadsEventCandidates.detailsOccurredAt, occurredAt)));
  });
}

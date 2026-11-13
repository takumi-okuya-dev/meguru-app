// 集金管理が受け取る共通の出来事（specs/collect/001-event-day-collection contracts/events.md 1・3、docs/module-map.md 6 の3）。
// 受け取りは、自分のトランザクションの中で出来事の番号を記録し、もうあれば何もしない（2回届いても結果を変えない）。
import { eq } from "drizzle-orm";
import { withTransaction, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import type { PlatformEvent } from "../../../platform";
import { collectEventSummaries, collectEvents, collectOwnerSettings, collectReceivedEvents, collectThreadsEventCandidates } from "../schema";

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
 * 退会した主催者の集金管理のデータをすべて消す（イベント。料金の区分・名簿・受付の記録・リンク・手伝う人・精算は CASCADE で一緒に消える。
 * イベントのまとめ・既定値・Threadsのイベントの候補も消す）。
 * 利用の数は伝えない：共通が、片づけが届いたあとで users の行と一緒に利用の数の行も消す。
 * @param event - 出来事（user.withdrawn）
 * @param env - Workers のバインディング
 */
export async function onUserWithdrawn(event: PlatformEvent<"user.withdrawn">, env: Env): Promise<void> {
  const { userId } = event.payload;
  await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return;
    await tx.delete(collectEvents).where(eq(collectEvents.ownerUserId, userId));
    await tx.delete(collectEventSummaries).where(eq(collectEventSummaries.ownerUserId, userId));
    await tx.delete(collectOwnerSettings).where(eq(collectOwnerSettings.ownerUserId, userId));
    await tx.delete(collectThreadsEventCandidates).where(eq(collectThreadsEventCandidates.ownerUserId, userId));
  });
}

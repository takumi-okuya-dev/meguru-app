// Threadsが受け取る共通の出来事（specs/meguru/029-threads-pattern1 contracts/platform-entry.md 3、research.md R8）。
// 受け取りは、自分のトランザクションの中で出来事の番号を記録し、もうあれば何もしない（2回届いても結果を変えない）。
import { createDb, withTransaction, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { reportUsage, type PlatformEvent } from "../../../platform";
import { cleanupForWithdrawal } from "../accounts/withdrawal-cleanup";
import { notifyWake } from "../publish/posting-schedule-service";
import { THREADS_APP } from "../registry";
import { threadsReceivedEvents } from "../schema";

/**
 * 受け取った出来事の番号を記録する。もう記録していれば false（何もしない）。
 * @param tx - Threadsのトランザクション
 * @param eventId - 出来事の番号
 * @returns 初めて受け取ったなら true
 */
export async function markReceived(tx: TxDb, eventId: string): Promise<boolean> {
  const rows = await tx.insert(threadsReceivedEvents).values({ eventId }).onConflictDoNothing().returning({ eventId: threadsReceivedEvents.eventId });
  return rows.length > 0;
}

/**
 * 退会した人のThreadsのデータを片づける（持ち主のアカウント・テスター招待・チーム・担当・記録の名前）。
 * 片づけたら、その人の利用の数を0・使っていないにする。
 * @param event - 出来事（user.withdrawn）
 * @param env - Workers のバインディング
 */
export async function onUserWithdrawn(event: PlatformEvent<"user.withdrawn">, env: Env): Promise<void> {
  const { userId } = event.payload;
  const done = await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return false;
    await cleanupForWithdrawal(tx, userId);
    return true;
  });
  if (done) await reportUsage(createDb(env.DATABASE_URL), userId, THREADS_APP, { quantity: 0, using: false, countedAt: new Date() });
}

/**
 * 運営者が上限を変えたら、自動投稿の定期処理を起こす（specs/024。起こすのは何度でも害がないので、番号は記録しない）。
 * @param _event - 出来事（limits.changed）
 * @param env - Workers のバインディング
 */
export async function onLimitsChanged(_event: PlatformEvent<"limits.changed">, env: Env): Promise<void> {
  await notifyWake(env.AUTOPOST_KV, new Date());
}

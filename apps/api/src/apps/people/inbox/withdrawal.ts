// 人物メモが受け取る退会の出来事（specs/people/001-people-memo contracts/events.md、research.md R19）。
// 受け取りは、自分のトランザクションの中で出来事の番号を記録し、もうあれば何もしない（2回届いても結果を変えない）。
import { eq } from "drizzle-orm";
import { withTransaction } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { logger } from "../../../kernel/logger";
import type { PlatformEvent } from "../../../platform";
import { peopleChoiceMappings, peopleColumnMappings, peopleEvents, peoplePersons, peopleReceivedEvents } from "../schema";

/**
 * 退会した人の人物メモのデータを消す（イベント・取り込み・回答・人・同意の記録・列と選択肢の対応・消した人の数と印）。
 * 利用の数は伝えない（共通が、届いたあとで利用の数の行も消す）。
 * @param event - 出来事（user.withdrawn）
 * @param env - Workers のバインディング
 */
export async function onUserWithdrawn(event: PlatformEvent<"user.withdrawn">, env: Env): Promise<void> {
  const { userId } = event.payload;
  const counts = await withTransaction(env.DATABASE_URL, async (tx) => {
    const fresh = await tx.insert(peopleReceivedEvents).values({ eventId: event.id }).onConflictDoNothing().returning({ eventId: peopleReceivedEvents.eventId });
    if (fresh.length === 0) return null;
    // イベントを消すと、取り込み・回答・手で足した会ったイベント・消した人の数と印も外部キーで消える
    const events = await tx.delete(peopleEvents).where(eq(peopleEvents.userId, userId)).returning({ id: peopleEvents.id });
    // 人を消すと、同意の記録も外部キーで消える
    const persons = await tx.delete(peoplePersons).where(eq(peoplePersons.userId, userId)).returning({ id: peoplePersons.id });
    await tx.delete(peopleColumnMappings).where(eq(peopleColumnMappings.userId, userId));
    await tx.delete(peopleChoiceMappings).where(eq(peopleChoiceMappings.userId, userId));
    return { events: events.length, persons: persons.length };
  });
  // ログには出来事の番号と消した行の数だけ（名前を出さない。R18）
  if (counts) logger.info("people data removed for withdrawal", { eventId: event.id, ...counts });
}

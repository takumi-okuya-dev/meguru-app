// 人物メモの利用の伝え方（specs/people/001-people-memo research.md R3）。料金は数えない（数はいつも0）。
// 「使っているか」は、イベントか人が1件以上あるか。イベント・取り込み・人を足す・消すトランザクションのあとで呼ぶ。
import { sql } from "drizzle-orm";
import type { Db } from "../../kernel/db/client";
import { reportUsage } from "../../platform";
import { PEOPLE_APP } from "./registry";
import { peopleEvents, peoplePersons } from "./schema";

/**
 * その人の人物メモの利用を、共通に伝える（トランザクションの外で呼ぶ）。
 * @param db - データベース
 * @param userId - 作り手（共通の利用者の番号）
 */
export async function reportPeopleUsage(db: Db, userId: string): Promise<void> {
  const now = new Date();
  const [row] = await db.execute<{ using: boolean }>(sql`SELECT
    EXISTS (SELECT 1 FROM ${peopleEvents} WHERE ${peopleEvents.userId} = ${userId})
    OR EXISTS (SELECT 1 FROM ${peoplePersons} WHERE ${peoplePersons.userId} = ${userId}) AS using`).then((r) => r.rows);
  await reportUsage(db, userId, PEOPLE_APP, { quantity: 0, using: Boolean(row?.using), countedAt: now });
}

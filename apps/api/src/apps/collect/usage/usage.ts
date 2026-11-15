// 集金管理の利用の値を共通へ伝える（docs/module-map.md 6 の4、specs/meguru/029-threads-pattern1 research.md R6）。
// 001 は料金なしなので、料金の数はいつも0。「使っているか」は、イベントが1つ以上あるか（すべてのアプリの画面と、入口の行き先に使う）。
import { COLLECT_APP } from "@meguru/shared";
import { eq } from "drizzle-orm";
import { createDb, type Db, type TxDb } from "../../../kernel/db/client";
import { logger } from "../../../kernel/logger";
import { reportUsage, usersWithUsage } from "../../../platform";
import { collectEvents } from "../schema";

/**
 * その人の集金管理の利用の値を数えて伝える。数える前の時刻を伝えるので、同時に伝えても古い値で上書きしない。
 * 失敗はログに残すだけにする（トランザクションのあとで呼ぶ。ずれは毎日の数え直しで直す）。
 * @param db - データベース
 * @param userId - 利用者の番号
 * @returns 伝えられたら true
 */
export async function syncCollectUsage(db: Db | TxDb, userId: string): Promise<boolean> {
  try {
    const countedAt = new Date();
    const rows = await db.select({ id: collectEvents.id }).from(collectEvents).where(eq(collectEvents.ownerUserId, userId)).limit(1);
    await reportUsage(db, userId, COLLECT_APP, { quantity: 0, using: rows.length > 0, countedAt });
    return true;
  } catch (err) {
    logger.error("collect usage: sync failed", { userId, err: String(err) });
    return false;
  }
}

/**
 * 毎日のまとめ処理：集金管理を使っている（使っていた）人全員の利用の値を数え直して伝える。
 * @param env - Workers のバインディング（DATABASE_URL）
 * @returns 数え直した人数（1人の失敗で、ほかの人を止めない）
 */
export async function recountCollectUsage(env: { DATABASE_URL: string }): Promise<number> {
  const db = createDb(env.DATABASE_URL);
  const [owners, recorded] = await Promise.all([
    db.selectDistinct({ userId: collectEvents.ownerUserId }).from(collectEvents),
    // 記録はあるが、もうイベントがない人も数え直す（使っていないに戻す）
    usersWithUsage(db, COLLECT_APP),
  ]);
  const ids = [...new Set([...owners.map((r) => r.userId), ...recorded])];
  for (const id of ids) await syncCollectUsage(db, id);
  return ids.length;
}

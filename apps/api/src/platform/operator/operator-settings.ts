// 運営者が決める値（operator_settings、1行だけ）。表の持ち主は共通（docs/module-map.md 2-1）。
// 027で tester-application-service から移した（上限の既定値は共通、tester_slot_capacity はThreadsが書き換えてよい例外）。
import { eq } from "drizzle-orm";
import type { Db, TxDb } from "../../kernel/db/client";
import { operatorSettings } from "../schema";

/**
 * 運営者が決める値（1行だけ）。
 * @param db - データベース（トランザクションの中でもよい）
 * @returns 行
 */
export async function readOperatorSettings(db: Db | TxDb) {
  const [row] = await db.select().from(operatorSettings).where(eq(operatorSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(operatorSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(operatorSettings).where(eq(operatorSettings.id, 1)).limit(1))[0]!;
}

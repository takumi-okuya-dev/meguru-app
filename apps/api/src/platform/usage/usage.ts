// 利用の数・利用の状態（specs/meguru/029-threads-pattern1 research.md R6、contracts/platform-entry.md 4）。
// アプリが、その人の利用の数（料金の数）と、使っているかを伝える。共通は表を書き、料金の数が変わったら
// Stripeへ数を合わせる印を付ける（今の quantity_sync_needed の仕組み）。共通はアプリの表を読まない。
import { and, eq, sql } from "drizzle-orm";
import type { Db, TxDb } from "../../kernel/db/client";
import { markQuantityDirty } from "../billing/billing-service";
import { appUsage } from "../schema";

/** アプリが伝える利用の値。 */
export type AppUsageReport = {
  /** 料金の数（Threadsでは、持ち主としてのアカウントの数） */
  quantity: number;
  /** 使っているか（「使っているアプリ」に出す） */
  using: boolean;
};

/**
 * その人の利用の数・利用の状態を伝える。アプリのトランザクションが終わったあと、応答を返す前に呼ぶ。
 * 料金の数（全アプリの合計）が変わったら、Stripeへ数を合わせる印を付ける。
 * @param db - データベース
 * @param userId - 利用者の番号
 * @param app - アプリの番号
 * @param usage - 利用の数と状態
 */
export async function reportUsage(db: Db | TxDb, userId: string, app: string, usage: AppUsageReport): Promise<void> {
  if (!Number.isInteger(usage.quantity) || usage.quantity < 0) throw new Error(`利用の数が正しくありません：${usage.quantity}`);
  const before = await billingQuantityOf(db, userId);
  await db
    .insert(appUsage)
    .values({ userId, app, quantity: usage.quantity, inUse: usage.using, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [appUsage.userId, appUsage.app],
      set: { quantity: usage.quantity, inUse: usage.using, updatedAt: new Date() },
    });
  const after = await billingQuantityOf(db, userId);
  if (after !== before) await markQuantityDirty(db, userId);
}

/**
 * その人の料金の数（全アプリの利用の数の合計。行がなければ0）。
 * @param db - データベース
 * @param userId - 利用者の番号
 * @returns 数
 */
export async function billingQuantityOf(db: Db | TxDb, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${appUsage.quantity}), 0)::int` })
    .from(appUsage)
    .where(eq(appUsage.userId, userId));
  return Number(row?.n ?? 0);
}

/**
 * その人が使っているアプリ（行がないアプリは使っていない）。
 * @param db - データベース
 * @param userId - 利用者の番号
 * @returns アプリの番号
 */
export async function usingAppsOf(db: Db | TxDb, userId: string): Promise<string[]> {
  const rows = await db
    .select({ app: appUsage.app })
    .from(appUsage)
    .where(and(eq(appUsage.userId, userId), eq(appUsage.inUse, true)));
  return rows.map((r) => r.app);
}

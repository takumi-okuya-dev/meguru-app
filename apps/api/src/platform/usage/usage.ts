// 利用の数・利用の状態（specs/meguru/029-threads-pattern1 research.md R6、contracts/platform-entry.md 4）。
// アプリが、その人の利用の数（料金の数）と、使っているかを伝える。共通は表を書き、料金の数が変わったら
// Stripeへ数を合わせる印を付ける（今の quantity_sync_needed の仕組み）。共通はアプリの表を読まない。
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db, TxDb } from "../../kernel/db/client";
import { billingQuantity } from "@meguru/shared";
import { appUsage, subscriptions } from "../schema";

/** アプリが伝える利用の値。 */
export type AppUsageReport = {
  /** 料金の数（Threadsでは、持ち主としてのアカウントの数） */
  quantity: number;
  /** 使っているか（「使っているアプリ」に出す） */
  using: boolean;
  /**
   * 数えた時刻（既定は今）。同じ人の数を同時に伝えたとき、先に数えた古い値が、あとから数えた新しい値を上書きしないよう、
   * これより新しい時刻の値がもう入っていれば書かない（セルフレビューの指摘）
   */
  countedAt?: Date;
};

/**
 * その人の利用の数・利用の状態を伝える。アプリのトランザクションが終わったあと、応答を返す前に呼ぶ。
 * 料金の数（全アプリの合計）が、最後にStripeへ送った数（subscriptions.quantity）と違えば、Stripeへ数を合わせる印を付ける。
 * 「前と比べて変わったか」で決めないので、書いたあとで印を付ける前に止まっても、同じ数を伝え直せば（毎日の数え直しでも）印が付き直る
 * （PR #92 のCodexレビュー）。
 * @param db - データベース
 * @param userId - 利用者の番号
 * @param app - アプリの番号
 * @param usage - 利用の数と状態
 */
export async function reportUsage(db: Db | TxDb, userId: string, app: string, usage: AppUsageReport): Promise<void> {
  if (!Number.isInteger(usage.quantity) || usage.quantity < 0) throw new Error(`利用の数が正しくありません：${usage.quantity}`);
  const countedAt = usage.countedAt ?? new Date();
  await db
    .insert(appUsage)
    .values({ userId, app, quantity: usage.quantity, inUse: usage.using, updatedAt: countedAt })
    .onConflictDoUpdate({
      target: [appUsage.userId, appUsage.app],
      set: { quantity: usage.quantity, inUse: usage.using, updatedAt: countedAt },
      setWhere: lte(appUsage.updatedAt, countedAt),
    });
  const quantity = billingQuantity(await billingQuantityOf(db, userId));
  await db
    .update(subscriptions)
    .set({ quantitySyncNeeded: true })
    .where(
      and(
        eq(subscriptions.userId, userId),
        sql`${subscriptions.stripeSubscriptionId} IS NOT NULL`,
        sql`${subscriptions.quantity} IS DISTINCT FROM ${quantity}`,
      ),
    );
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

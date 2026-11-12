// アカウントの持ち主（オーナー）の判定（029 で共通から移した。specs/meguru/029-threads-pattern1 research.md R1）。
// 公開の直前・時刻の処理・メンションで、そのアカウントのオーナーが使えるかを確かめる。
import { DAILY_POST_LIMIT_MAX } from "@meguru/shared";
import { and, eq } from "drizzle-orm";
import type { BillingMode } from "../../../kernel/config";
import type { Db, TxDb } from "../../../kernel/db/client";
import { dailyPostLimitSql, entitlementFromFacts, featureOnSql, loadEntitlement } from "../../../platform";
import { users } from "../../../platform/schema";
import { memberships } from "../schema";

/**
 * アカウントのオーナーが自動投稿を使えるか（公開の直前の確かめ。research.md R12）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @returns 使えるなら true（オーナーがいなければ true。ほかの確かめに任せる）
 */
export async function ownerAutopostOn(db: Db | TxDb, accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: featureOnSql(memberships.userId, "autopost") })
    .from(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "owner")))
    .limit(1);
  return row?.on ?? true;
}

/**
 * アカウントのオーナーの1日の投稿数の上限（投稿の直前の確認で使う。specs/024 research.md R7）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @param operators - 運営者の clerk_user_id
 * @returns 上限（オーナーがいなければ Threads の上限）
 */
export async function ownerDailyPostLimit(db: Db | TxDb, accountId: string, operators: readonly string[]): Promise<number> {
  const [row] = await db
    .select({ limit: dailyPostLimitSql(users.clerkUserId, users.dailyPostLimit, operators) })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "owner")))
    .limit(1);
  return row?.limit ?? DAILY_POST_LIMIT_MAX;
}

/**
 * アカウントのオーナーの使える状態を読む（定期処理が使う。specs/013 research.md R8）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @param mode - 決済のモード
 * @param now - 今の時刻
 * @returns 使える状態。オーナーがいなければ null
 */
export async function loadOwnerEntitlement(db: Db | TxDb, accountId: string, mode: BillingMode, now: Date = new Date()) {
  // 決済もテスト用のグループもOFFなら、オーナーを読むまでもなく全権（specs/016 research.md R4）
  if (!mode.enabled && !mode.testGroups) {
    return entitlementFromFacts(mode, { createdAt: now, legacyTrial: false, billingExempt: false, status: null, cancelAtPeriodEnd: null }, now);
  }
  const [owner] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "owner")))
    .limit(1);
  return owner ? loadEntitlement(db, owner.userId, mode, now) : null;
}

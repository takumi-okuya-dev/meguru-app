// 契約と支払い（specs/013-billing research.md R1・R4〜R7）。Stripeとのやり取りは、このファイルと lib/stripe-client.ts の外に書かない。
import { entitlementOf, trialDaysLeft, type Entitlement, type MeBilling, type SubscriptionStatus } from "@threads-grower/shared";
import { eq } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { subscriptions, users } from "../db/schema";
import type { BillingMode } from "../lib/config";

/** 判定に使う、利用者と契約の値（users・subscriptions の行の一部）。 */
export type BillingFacts = {
  createdAt: Date;
  billingExempt: boolean;
  status: string | null;
  cancelAtPeriodEnd: boolean | null;
};

/**
 * 利用者と契約の値から、使える状態を求める（research.md R1）。
 * @param mode - 決済のモード
 * @param facts - 登録日時・料金なしの印・契約の状態
 * @param now - 今の時刻
 * @returns 使える状態
 */
export function entitlementFromFacts(mode: BillingMode, facts: BillingFacts, now: Date = new Date()): Entitlement {
  return entitlementOf({
    billingEnabled: mode.enabled,
    exempt: facts.billingExempt,
    userCreatedAt: facts.createdAt,
    subscription:
      facts.status === null && facts.cancelAtPeriodEnd === null
        ? null
        : { status: (facts.status as SubscriptionStatus | null) ?? null, cancelAtPeriodEnd: facts.cancelAtPeriodEnd ?? false },
    now,
  });
}

/**
 * 利用者の使える状態を読む（users と subscriptions を読んで entitlementOf する）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param mode - 決済のモード
 * @param now - 今の時刻
 * @returns 使える状態。利用者がいなければ null
 */
export async function loadEntitlement(db: Db | TxDb, userId: string, mode: BillingMode, now: Date = new Date()) {
  const [row] = await db
    .select({
      createdAt: users.createdAt,
      billingExempt: users.billingExempt,
      status: subscriptions.status,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return entitlementFromFacts(mode, row, now);
}

/**
 * 使える状態を、画面（/api/me の billing）に出す形にする。
 * @param mode - 決済のモード
 * @param e - 使える状態
 * @param now - 今の時刻
 * @returns /api/me の billing
 */
export function toMeBilling(mode: BillingMode, e: Entitlement, now: Date = new Date()): MeBilling {
  return {
    mode: mode.enabled ? "enabled" : "disabled",
    state: e.state,
    readOnlyReason: e.readOnlyReason,
    trialEndsAt: e.trialEndsAt.toISOString(),
    trialDaysLeft: e.state === "trial" || e.state === "subscribed_trial" ? trialDaysLeft(e.trialEndsAt, now) : null,
  };
}

// 無料体験と契約による、利用者の使える状態の判定（specs/013-billing research.md R1・R3・R4）。
// 使える状態の条件はこのファイルだけに置き、API（権限の判定・上限・定期処理）とWebが同じ関数を使う（Constitution原則V）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 基本料金（月・税込み。アカウント1件目を含む）。Stripeの料金の1段目と同じ値にする（research.md R3）。 */
export const BILLING_BASE_PRICE_JPY = 1000;
/** 2件目以降のアカウント1件あたりの料金（月・税込み）。Stripeの料金の2段目と同じ値にする。 */
export const BILLING_EXTRA_PRICE_JPY = 500;
/** 無料体験中に持てるアカウントの数（PRD FR-2・FR-12）。 */
export const TRIAL_ACCOUNT_LIMIT = 1;
/** 無料体験の終わりの帯を出し始める日数（spec FR-046）。 */
export const TRIAL_ENDING_NOTICE_DAYS = 7;
/** Checkout の trial_end に置ける、今からの最短の時間（Stripeの制約。research.md R4）。 */
export const CHECKOUT_TRIAL_MIN_HOURS = 48;

/** Stripeの契約の状態（data-model.md「subscriptions.status」）。 */
export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "paused",
] as const;
/** Stripeの契約の状態。 */
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** 利用者の使える状態（research.md R1）。 */
export type BillingState =
  | "billing_disabled"
  | "exempt"
  | "trial"
  | "subscribed_trial"
  | "active"
  | "canceling"
  | "read_only";

/** 読むだけの理由。 */
export type ReadOnlyReason = "trial_ended" | "payment_failed" | "canceled";

/** entitlementOf の入力。 */
export type EntitlementInput = {
  /** 環境の決済がONか（BILLING_ENABLED） */
  billingEnabled: boolean;
  /** 料金なしの印（users.billing_exempt） */
  exempt: boolean;
  /** 登録日時（users.created_at。無料体験の起点） */
  userCreatedAt: Date;
  /** 契約。Stripeの顧客がない・契約がまだないときは null か status が null */
  subscription: { status: SubscriptionStatus | null; cancelAtPeriodEnd: boolean } | null;
  now: Date;
};

/** 利用者の使える状態。 */
export type Entitlement = {
  state: BillingState;
  /** すべて使えるか（読むだけでない） */
  fullAccess: boolean;
  /** 読むだけの理由（read_only のときだけ） */
  readOnlyReason: ReadOnlyReason | null;
  /** オーナーとして持てるアカウントの数。null は上限なし、0 は作れない */
  accountLimit: number | null;
  /** 無料体験の終わる時刻 */
  trialEndsAt: Date;
};

/**
 * 無料体験の終了時刻を求める。日本時間の暦で1か月後の同じ時刻とし、日がない月は月の最終日に丸める。
 * @param userCreatedAt - ユーザーの登録日時（users.created_at）
 * @returns 無料体験の終了時刻（この時刻より前が無料体験中）
 */
export function trialEndsAt(userCreatedAt: Date): Date {
  const jst = new Date(userCreatedAt.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(jst.getUTCDate(), lastDay);
  const endJst = Date.UTC(
    year,
    month,
    day,
    jst.getUTCHours(),
    jst.getUTCMinutes(),
    jst.getUTCSeconds(),
    jst.getUTCMilliseconds(),
  );
  return new Date(endJst - JST_OFFSET_MS);
}

/**
 * ユーザーが無料体験中かを確かめる。
 * @param userCreatedAt - ユーザーの登録日時
 * @param now - 現在時刻
 * @returns 無料体験中なら true
 */
export function isInTrial(userCreatedAt: Date, now: Date): boolean {
  return now.getTime() < trialEndsAt(userCreatedAt).getTime();
}

/**
 * 利用者の使える状態を決める（research.md R1 の表。上の行から順に見る）。
 * @param input - 決済のモード・料金なしの印・登録日時・契約・今の時刻
 * @returns 使える状態
 */
export function entitlementOf(input: EntitlementInput): Entitlement {
  const ends = trialEndsAt(input.userCreatedAt);
  const full = (state: BillingState, accountLimit: number | null): Entitlement => ({
    state,
    fullAccess: true,
    readOnlyReason: null,
    accountLimit,
    trialEndsAt: ends,
  });
  const readOnly = (reason: ReadOnlyReason): Entitlement => ({
    state: "read_only",
    fullAccess: false,
    readOnlyReason: reason,
    accountLimit: 0,
    trialEndsAt: ends,
  });
  if (!input.billingEnabled) return full("billing_disabled", null);
  if (input.exempt) return full("exempt", null);
  const status = input.subscription?.status ?? null;
  if (status === "trialing") return full("subscribed_trial", null);
  if (status === "active") return full(input.subscription?.cancelAtPeriodEnd ? "canceling" : "active", null);
  // 支払いの失敗は、無料体験の期間より先に見る（spec Clarifications：すぐに読むだけ）
  if (status === "past_due" || status === "unpaid" || status === "paused") return readOnly("payment_failed");
  if (input.now.getTime() < ends.getTime()) return full("trial", TRIAL_ACCOUNT_LIMIT);
  if (status === "canceled") return readOnly("canceled");
  return readOnly("trial_ended");
}

/** Checkout の試用の指定（research.md R4）。 */
export type CheckoutTrial = { trialEnd: Date } | { trialPeriodDays: 1 } | null;

/**
 * 無料体験中に契約するときの、Checkout の試用を決める。残りが48時間以上なら無料体験の終わりにそろえ、
 * 48時間未満なら1日、終わっていれば試用を付けない（その場で請求）。
 * @param trialEnd - 無料体験の終わる時刻
 * @param now - 今の時刻
 * @returns 試用の指定。付けなければ null
 */
export function checkoutTrialFor(trialEnd: Date, now: Date): CheckoutTrial {
  const left = trialEnd.getTime() - now.getTime();
  if (left <= 0) return null;
  if (left >= CHECKOUT_TRIAL_MIN_HOURS * HOUR_MS) return { trialEnd };
  return { trialPeriodDays: 1 };
}

/**
 * Stripeの契約の数（0件でも1。基本料金は下がらない）。
 * @param ownedCount - オーナーのアカウントの数
 * @returns 契約の数
 */
export function billingQuantity(ownedCount: number): number {
  return Math.max(ownedCount, 1);
}

/**
 * 次の請求の見込みの金額（税込み・円）。
 * @param ownedCount - オーナーのアカウントの数
 * @returns 金額
 */
export function nextInvoiceAmount(ownedCount: number): number {
  return BILLING_BASE_PRICE_JPY + BILLING_EXTRA_PRICE_JPY * (billingQuantity(ownedCount) - 1);
}

/**
 * 無料体験の残りの日数。日本時間の日付で数え、終わる日を含まない（終わる日の当日は0）。
 * @param trialEnd - 無料体験の終わる時刻
 * @param now - 今の時刻
 * @returns 残りの日数（0以上）
 */
export function trialDaysLeft(trialEnd: Date, now: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + JST_OFFSET_MS) / DAY_MS);
  return Math.max(0, day(trialEnd) - day(now));
}

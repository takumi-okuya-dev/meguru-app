import { describe, expect, it } from "vitest";
import {
  billingQuantity,
  checkoutTrialFor,
  entitlementOf,
  isInTrial,
  nextInvoiceAmount,
  BILLING_UNIT_PRICE_JPY,
  trialDaysLeft,
  trialEndsAt,
  type EntitlementInput,
  type SubscriptionStatus,
} from "../src/billing";

const HOUR = 60 * 60 * 1000;
// 2026-10-01 12:00 JST に登録 → 無料体験は 2026-11-01 12:00 JST まで
const created = new Date("2026-10-01T03:00:00.000Z");
const inTrial = new Date("2026-10-20T03:00:00.000Z");
const afterTrial = new Date("2026-11-05T03:00:00.000Z");

const base = (over: Partial<EntitlementInput> = {}): EntitlementInput => ({
  billingEnabled: true,
  exempt: false,
  userCreatedAt: created,
  subscription: null,
  now: inTrial,
  // 024の前からいた人（無料体験を使える）。024のあとの人は legacyTrial: false（specs/024 research.md R8）
  legacyTrial: true,
  ...over,
});
const sub = (status: SubscriptionStatus, cancelAtPeriodEnd = false) => ({ status, cancelAtPeriodEnd });

describe("無料体験の期間（specs/002 research.md R14 から移した）", () => {
  it("日本時間の暦で1か月後の同じ時刻。日がない月は月末に丸める", () => {
    expect(trialEndsAt(new Date("2026-03-15T03:00:00.000Z")).toISOString()).toBe("2026-04-15T03:00:00.000Z");
    expect(trialEndsAt(new Date("2026-12-10T00:00:00.000Z")).toISOString()).toBe("2027-01-10T00:00:00.000Z");
    expect(trialEndsAt(new Date("2026-01-31T03:00:00.000Z")).toISOString()).toBe("2026-02-28T03:00:00.000Z");
    expect(trialEndsAt(new Date("2028-01-31T03:00:00.000Z")).toISOString()).toBe("2028-02-29T03:00:00.000Z");
    expect(trialEndsAt(new Date("2026-01-31T23:30:00.000Z")).toISOString()).toBe("2026-02-28T23:30:00.000Z");
  });

  it("終わる時刻より前が無料体験中", () => {
    const c = new Date("2026-03-15T03:00:00.000Z");
    expect(isInTrial(c, new Date("2026-04-15T02:59:59.999Z"))).toBe(true);
    expect(isInTrial(c, new Date("2026-04-15T03:00:00.000Z"))).toBe(false);
  });
});

describe("entitlementOf（research.md R1 の表）", () => {
  it("決済OFFなら、だれでもすべて使え、上限なし", () => {
    const e = entitlementOf(base({ billingEnabled: false, now: afterTrial, subscription: sub("past_due") }));
    expect(e).toMatchObject({ state: "billing_disabled", fullAccess: true, readOnlyReason: null, accountLimit: null });
  });

  it("料金なしの印なら、無料体験の後も契約なしですべて使える", () => {
    expect(entitlementOf(base({ exempt: true, now: afterTrial }))).toMatchObject({
      state: "exempt",
      fullAccess: true,
      accountLimit: null,
    });
  });

  it("trialing は無料体験中（契約済み）で上限なし", () => {
    expect(entitlementOf(base({ subscription: sub("trialing") }))).toMatchObject({
      state: "subscribed_trial",
      fullAccess: true,
      accountLimit: null,
    });
  });

  it("active は契約中、解約の予約があれば canceling（どちらもすべて使える）", () => {
    expect(entitlementOf(base({ now: afterTrial, subscription: sub("active") })).state).toBe("active");
    const e = entitlementOf(base({ now: afterTrial, subscription: sub("active", true) }));
    expect(e).toMatchObject({ state: "canceling", fullAccess: true, accountLimit: null });
  });

  it.each(["past_due", "unpaid", "paused"] as const)("%s は無料体験中でも支払いの失敗で読むだけ", (status) => {
    expect(entitlementOf(base({ subscription: sub(status) }))).toMatchObject({
      state: "read_only",
      fullAccess: false,
      readOnlyReason: "payment_failed",
      accountLimit: 0,
    });
  });

  it("契約なしで無料体験中なら trial（上限1）", () => {
    expect(entitlementOf(base())).toMatchObject({ state: "trial", fullAccess: true, readOnlyReason: null, accountLimit: 1 });
  });

  it.each(["incomplete", "incomplete_expired"] as const)("%s は契約なしと同じ", (status) => {
    expect(entitlementOf(base({ subscription: sub(status) })).state).toBe("trial");
    expect(entitlementOf(base({ now: afterTrial, subscription: sub(status) }))).toMatchObject({
      state: "read_only",
      readOnlyReason: "trial_ended",
    });
  });

  it("canceled は無料体験中なら trial、終わっていれば canceled で読むだけ", () => {
    expect(entitlementOf(base({ subscription: sub("canceled") })).state).toBe("trial");
    expect(entitlementOf(base({ now: afterTrial, subscription: sub("canceled") }))).toMatchObject({
      state: "read_only",
      fullAccess: false,
      readOnlyReason: "canceled",
      accountLimit: 0,
    });
  });

  it("契約なしで無料体験が終わったら trial_ended で読むだけ", () => {
    expect(entitlementOf(base({ now: afterTrial }))).toMatchObject({
      state: "read_only",
      fullAccess: false,
      readOnlyReason: "trial_ended",
      accountLimit: 0,
    });
  });

  it("無料体験の終わる時刻を返す", () => {
    expect(entitlementOf(base()).trialEndsAt.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});

describe("checkoutTrialFor（research.md R4。Checkout の trial_end は48時間以上先）", () => {
  const end = new Date("2026-11-01T03:00:00.000Z");
  it("残りが48時間以上なら、試用の終わり＝無料体験の終わり", () => {
    expect(checkoutTrialFor(end, new Date(end.getTime() - 48 * HOUR))).toEqual({ trialEnd: end });
    expect(checkoutTrialFor(end, new Date(end.getTime() - 10 * 24 * HOUR))).toEqual({ trialEnd: end });
  });
  it("48時間未満なら1日", () => {
    expect(checkoutTrialFor(end, new Date(end.getTime() - 48 * HOUR + 1))).toEqual({ trialPeriodDays: 1 });
    expect(checkoutTrialFor(end, new Date(end.getTime() - 1))).toEqual({ trialPeriodDays: 1 });
  });
  it("終わっていれば試用なし", () => {
    expect(checkoutTrialFor(end, end)).toBeNull();
    expect(checkoutTrialFor(end, new Date(end.getTime() + HOUR))).toBeNull();
  });
});

describe("請求の数と金額（research.md R3）", () => {
  it("数は max(n,1)", () => {
    expect(billingQuantity(0)).toBe(1);
    expect(billingQuantity(1)).toBe(1);
    expect(billingQuantity(3)).toBe(3);
  });
  it("次の請求の見込みは 1,000円＋(max(n,1)−1)×500円", () => {
    expect(nextInvoiceAmount(0)).toBe(1000);
    expect(nextInvoiceAmount(1)).toBe(1000);
    expect(nextInvoiceAmount(3)).toBe(3000);
  });
});

describe("trialDaysLeft（日本時間の日付で数え、終わる日を含まない）", () => {
  const end = new Date("2026-11-01T03:00:00.000Z"); // 11/1 12:00 JST
  it("前日は1、当日は0、終わった後も0", () => {
    expect(trialDaysLeft(end, new Date("2026-10-31T14:59:00.000Z"))).toBe(1); // 10/31 23:59 JST
    expect(trialDaysLeft(end, new Date("2026-10-31T15:00:00.000Z"))).toBe(0); // 11/1 0:00 JST
    expect(trialDaysLeft(end, new Date("2026-11-03T00:00:00.000Z"))).toBe(0);
  });
  it("10日前は10", () => {
    expect(trialDaysLeft(end, new Date("2026-10-22T03:00:00.000Z"))).toBe(10);
  });
});

describe("無料体験の廃止（specs/024 data-model.md 3、FR-029〜FR-031）", () => {
  const fresh = (over: Partial<EntitlementInput> = {}) => base({ legacyTrial: false, ...over });

  it("024のあとの人で契約がなければ unsubscribed（使えない・作れない）。登録から1か月の間でも同じ", () => {
    for (const now of [inTrial, afterTrial]) {
      expect(entitlementOf(fresh({ now }))).toMatchObject({
        state: "unsubscribed",
        fullAccess: false,
        readOnlyReason: "not_subscribed",
        accountLimit: 0,
      });
    }
    for (const status of ["incomplete", "incomplete_expired"] as const) {
      expect(entitlementOf(fresh({ subscription: sub(status) })).state).toBe("unsubscribed");
    }
  });

  it("契約すれば使え、解約・支払いの失敗は今のとおり読むだけ", () => {
    expect(entitlementOf(fresh({ subscription: sub("active") })).state).toBe("active");
    expect(entitlementOf(fresh({ subscription: sub("canceled") }))).toMatchObject({ state: "read_only", readOnlyReason: "canceled" });
    expect(entitlementOf(fresh({ subscription: sub("past_due") }))).toMatchObject({ state: "read_only", readOnlyReason: "payment_failed" });
  });

  it("料金なし・決済OFFは今のまま", () => {
    expect(entitlementOf(fresh({ exempt: true })).state).toBe("exempt");
    expect(entitlementOf(fresh({ billingEnabled: false })).state).toBe("billing_disabled");
  });

  it("前からの無料体験は、終わる日まで trial（上限1件）、終わったら trial_ended", () => {
    expect(entitlementOf(base())).toMatchObject({ state: "trial", accountLimit: 1 });
    expect(entitlementOf(base({ now: afterTrial }))).toMatchObject({ state: "read_only", readOnlyReason: "trial_ended" });
  });

  it("料金はアカウント1件につき月1,000円（0件でも1件分）", () => {
    expect(BILLING_UNIT_PRICE_JPY).toBe(1000);
    expect(nextInvoiceAmount(0)).toBe(1000);
    expect(nextInvoiceAmount(2)).toBe(2000);
  });
});

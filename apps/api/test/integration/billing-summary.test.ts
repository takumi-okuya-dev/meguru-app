// GET /api/billing（specs/013-billing contracts/api.md「BillingSummary」、T024）
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, insertSubscription, makeApp, resetDb, setBillingExempt } from "../helpers/app";
import { callBilling } from "../helpers/billing";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

async function summary(user: string, on = true) {
  const res = on ? await callBilling(app, "GET", "/api/billing", { user }) : await call(app, "GET", "/api/billing", { user });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown> & { subscription: Record<string, unknown> | null };
}

describe("GET /api/billing", () => {
  it("決済OFFなら mode: disabled で、ほかは null（料金は出す）", async () => {
    await createUserWithAccount("u1");
    expect(await summary("u1", false)).toEqual({
      mode: "disabled",
      state: "billing_disabled",
      readOnlyReason: null,
      trialEndsAt: null,
      trialDaysLeft: null,
      ownedAccountCount: null,
      subscription: null,
      prices: { base: 1000, extra: 500 },
    });
  });

  it("無料体験中：終わる日・残りの日数・アカウントの数。契約は null", async () => {
    await createUserWithAccount("u1");
    const s = await summary("u1");
    expect(s).toMatchObject({ mode: "enabled", state: "trial", ownedAccountCount: 1, subscription: null });
    expect(s.trialDaysLeft).toBeGreaterThanOrEqual(28);
  });

  it("料金なし", async () => {
    const { userId } = await createUserWithAccount("u1");
    await setBillingExempt(userId, true);
    expect(await summary("u1")).toMatchObject({ state: "exempt", subscription: null });
  });

  it("契約中：次の請求日と見込み（2件なら1,500円、0件でも1,000円）", async () => {
    const { userId } = await createUserWithAccount("u1");
    await createUserWithAccount("u1");
    await endTrial(userId);
    const end = new Date(Date.now() + 10 * 86_400_000);
    await insertSubscription(userId, { status: "active", currentPeriodEnd: end });
    expect((await summary("u1")).subscription).toEqual({
      status: "active",
      currentPeriodEnd: end.toISOString(),
      cancelAtPeriodEnd: false,
      nextInvoiceAt: end.toISOString(),
      nextInvoiceAmount: 1500,
    });
  });

  it("解約の予約なら、次の請求はない（canceling）", async () => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "active", cancelAtPeriodEnd: true });
    const s = await summary("u1");
    expect(s.state).toBe("canceling");
    expect(s.subscription).toMatchObject({ cancelAtPeriodEnd: true, nextInvoiceAt: null, nextInvoiceAmount: null });
  });
});

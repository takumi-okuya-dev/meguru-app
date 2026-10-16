// GET /api/me の billing（specs/013-billing contracts/api.md「自分」）と、ホームの入力状況の残りの日数
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, insertSubscription, makeApp, resetDb, setBillingExempt } from "../helpers/app";
import { callBilling } from "../helpers/billing";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

type Billing = {
  mode: string;
  state: string;
  readOnlyReason: string | null;
  trialEndsAt: string;
  trialDaysLeft: number | null;
};

async function billingOf(user: string, on = true) {
  const res = on ? await callBilling(app, "GET", "/api/me", { user }) : await call(app, "GET", "/api/me", { user });
  expect(res.status).toBe(200);
  return (await res.json()) as { billing: Billing; withdrawalInProgress: boolean };
}

describe("GET /api/me の billing", () => {
  it("はじめての人は無料体験中で、残りの日数がある", async () => {
    const me = await billingOf("new");
    expect(me.billing).toMatchObject({ mode: "enabled", state: "trial", readOnlyReason: null });
    expect(me.billing.trialDaysLeft).toBeGreaterThanOrEqual(28);
    expect(new Date(me.billing.trialEndsAt).getTime()).toBeGreaterThan(Date.now());
    expect(me.withdrawalInProgress).toBe(false);
  });

  it("契約・料金なし・読むだけ・決済OFFの状態", async () => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "trialing" });
    expect((await billingOf("u1")).billing).toMatchObject({ state: "subscribed_trial" });
    expect((await billingOf("u1")).billing.trialDaysLeft).not.toBeNull();

    await endTrial(userId);
    await insertSubscription(userId, { status: "active" });
    expect((await billingOf("u1")).billing).toMatchObject({ state: "active", trialDaysLeft: null });

    await insertSubscription(userId, { status: "canceled" });
    expect((await billingOf("u1")).billing).toMatchObject({ state: "read_only", readOnlyReason: "canceled" });

    await setBillingExempt(userId, true);
    expect((await billingOf("u1")).billing).toMatchObject({ state: "exempt", readOnlyReason: null });

    expect((await billingOf("u1", false)).billing).toMatchObject({ mode: "disabled", state: "billing_disabled" });
  });
});

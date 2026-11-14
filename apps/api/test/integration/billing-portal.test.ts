// カスタマーポータルと解約（specs/013-billing FR-033・FR-034、research.md R7、T042）。決済ON・偽のStripe。
import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithAccount, endTrial, makeApp, resetDb } from "../helpers/app";
import { callBilling, fakeStripe } from "../helpers/billing";
import { TEST_WEB_ORIGIN } from "../env";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fakeStripe.reset();
});

describe("POST /api/billing/portal", () => {
  it("ポータルのURLを返し、戻り先は「契約と支払い」", async () => {
    await createUserWithAccount("u1");
    const { url } = (await (await callBilling(app, "POST", "/api/billing/checkout", { user: "u1" })).json()) as { url: string };
    await fakeStripe.completeCheckout(url);
    const res = await callBilling(app, "POST", "/api/billing/portal", { user: "u1" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toContain("/portal/cus_");
    const req = (await fakeStripe.requests()).find((r) => r.path === "/v1/billing_portal/sessions")!;
    expect(req.params.return_url).toBe(`${TEST_WEB_ORIGIN}/settings/billing`);
  });

  it("顧客がなければ 409 NO_SUBSCRIPTION", async () => {
    await createUserWithAccount("u1");
    const res = await callBilling(app, "POST", "/api/billing/portal", { user: "u1" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NO_SUBSCRIPTION");
  });
});

describe("解約", () => {
  it("解約の予約の間は canceling ですべて使え、期間が終わって canceled になると読むだけ", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await endTrial(userId);
    const { url } = (await (await callBilling(app, "POST", "/api/billing/checkout", { user: "u1" })).json()) as { url: string };
    await fakeStripe.completeCheckout(url);
    const customer = (await fakeStripe.subscriptions())[0]!.customer;

    await fakeStripe.setStatus({ customer }, { cancelAtPeriodEnd: true });
    const s1 = (await (await callBilling(app, "POST", "/api/billing/sync", { user: "u1" })).json()) as { state: string };
    expect(s1.state).toBe("canceling");
    const write = () => callBilling(app, "POST", `/api/threads/accounts/${accountId}/research-keywords`, { user: "u1", body: { keyword: crypto.randomUUID() } });
    expect((await write()).status).toBe(201);

    await fakeStripe.setStatus({ customer }, { status: "canceled" });
    const s2 = (await (await callBilling(app, "POST", "/api/billing/sync", { user: "u1" })).json()) as { state: string; readOnlyReason: string };
    expect(s2).toMatchObject({ state: "read_only", readOnlyReason: "canceled" });
    expect((await write()).status).toBe(403);
  });
});

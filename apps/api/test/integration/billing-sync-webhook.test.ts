// 契約の状態の反映（specs/013-billing FR-023・FR-035・FR-056、SC-006、research.md R5、T026）。決済ON・偽のStripe。
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions } from "../../src/db/schema";
import { createUserWithAccount, db, makeApp, resetDb, testEnv } from "../helpers/app";
import { billingEnv, callBilling, fakeStripe, sendWebhook } from "../helpers/billing";
import { syncCustomer } from "../../src/services/billing-service";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fakeStripe.reset();
});

/** 契約して、偽のCheckoutを終える（Webhookは送らない）。 */
async function subscribe(user: string) {
  const { userId } = await createUserWithAccount(user);
  const { url } = (await (await callBilling(app, "POST", "/api/billing/checkout", { user })).json()) as { url: string };
  const done = await fakeStripe.completeCheckout(url);
  expect(done.status).toBe(302);
  const [row] = await db().select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return { userId, customer: row!.stripeCustomerId };
}

const rowOf = async (userId: string) => (await db().select().from(subscriptions).where(eq(subscriptions.userId, userId)))[0]!;

describe("POST /api/billing/sync", () => {
  it("Checkoutから戻ったら、知らせを待たずに読み直して「無料体験中（契約済み）」になる", async () => {
    const { userId } = await subscribe("u1");
    expect((await rowOf(userId)).status).toBeNull();
    const res = await callBilling(app, "POST", "/api/billing/sync", { user: "u1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "subscribed_trial", subscription: { status: "trialing" } });
    const row = await rowOf(userId);
    expect(row).toMatchObject({ status: "trialing", quantity: 1, pendingCheckoutSessionId: null, cancelAtPeriodEnd: false });
    expect(row.stripeSubscriptionId).toMatch(/^sub_/);
    expect(row.currentPeriodEnd).not.toBeNull();
  });

  it("顧客がなければ読み直さずに返す", async () => {
    await createUserWithAccount("u1");
    const res = await callBilling(app, "POST", "/api/billing/sync", { user: "u1" });
    expect(await res.json()).toMatchObject({ state: "trial", subscription: null });
    expect(await fakeStripe.requests()).toHaveLength(0);
  });
});

describe("POST /api/stripe/webhook", () => {
  it("署名がない・違う・5分より古いと 400 で、状態は変わらない", async () => {
    const { userId, customer } = await subscribe("u1");
    const event = { type: "customer.subscription.updated", data: { object: { customer } } };
    expect((await sendWebhook(app, event, { signature: null })).status).toBe(400);
    expect((await sendWebhook(app, event, { secret: "whsec_WrongSecret00000" })).status).toBe(400);
    expect((await sendWebhook(app, event, { at: new Date(Date.now() - 6 * 60_000) })).status).toBe(400);
    expect((await rowOf(userId)).status).toBeNull();
  });

  it("正しい知らせで読み直す。同じ知らせを2回送っても結果は同じ", async () => {
    const { userId, customer } = await subscribe("u1");
    const event = { id: "evt_same", type: "checkout.session.completed", data: { object: { customer } } };
    expect((await sendWebhook(app, event)).status).toBe(200);
    const first = await rowOf(userId);
    expect(first.status).toBe("trialing");
    expect((await sendWebhook(app, event)).status).toBe(200);
    const second = await rowOf(userId);
    expect({ ...second, stripeSyncedAt: null, updatedAt: null }).toEqual({ ...first, stripeSyncedAt: null, updatedAt: null });
  });

  it("支払いの失敗の知らせで past_due になり、払えば active に戻る（知らせの中身でなくStripeの今の状態）", async () => {
    const { userId, customer } = await subscribe("u1");
    await fakeStripe.setStatus({ customer }, { status: "past_due" });
    // 知らせの中身は古い（active と書いてある）が、読み直すので past_due になる
    await sendWebhook(app, { type: "invoice.payment_failed", data: { object: { customer, status: "active" } } });
    expect((await rowOf(userId)).status).toBe("past_due");
    await fakeStripe.setStatus({ customer }, { status: "active" });
    await sendWebhook(app, { type: "invoice.paid", data: { object: { customer } } });
    expect((await rowOf(userId)).status).toBe("active");
  });

  it("古い読み直しで、新しい読み直しの結果を上書きしない", async () => {
    const { userId, customer } = await subscribe("u1");
    const future = new Date(Date.now() + 60_000);
    await db().update(subscriptions).set({ status: "active", stripeSyncedAt: future }).where(eq(subscriptions.userId, userId));
    await syncCustomer(billingEnv(), customer);
    expect((await rowOf(userId)).status).toBe("active");
  });

  it("扱わない種類・知らない顧客は 200 で何もしない（退会した人の知らせ。FR-056）", async () => {
    await createUserWithAccount("u1");
    expect((await sendWebhook(app, { type: "customer.created", data: { object: { customer: "cus_x" } } })).status).toBe(200);
    expect((await sendWebhook(app, { type: "invoice.paid", data: { object: { customer: "cus_unknown" } } })).status).toBe(200);
    expect(await fakeStripe.requests()).toHaveLength(0);
  });

  it("1つの顧客に終わっていない契約が2つあれば、古い方を残し、新しい方を止める", async () => {
    const { userId, customer } = await subscribe("u1");
    const second = await fakeStripe.createSubscription(customer, { status: "active" });
    await sendWebhook(app, { type: "customer.subscription.created", data: { object: { customer } } });
    const subs = await fakeStripe.subscriptions();
    expect(subs.find((s) => s.id === second.id)!.status).toBe("canceled");
    const row = await rowOf(userId);
    expect(row.stripeSubscriptionId).not.toBe(second.id);
    expect(row.status).toBe("trialing");
  });

  it("決済OFFなら 404", async () => {
    const res = await app.request("/api/stripe/webhook", { method: "POST", body: "{}" }, testEnv);
    expect(res.status).toBe(404);
  });
});

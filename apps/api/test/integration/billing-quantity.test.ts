// アカウントの数を請求に反映する（specs/013-billing FR-030・FR-036、SC-005、research.md R6、T041）。決済ON・偽のStripe。
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions } from "../../src/db/schema";
import { reconcileSubscriptions } from "../../src/platform/billing/billing-service";
import { createUserWithAccount, db, makeApp, resetDb, testEnv } from "../helpers/app";
import { billingEnv, callBilling, fakeStripe } from "../helpers/billing";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fakeStripe.reset();
});

/** 契約中の利用者（偽のCheckoutを終えて読み直した状態）。 */
async function subscribed(user: string) {
  const { userId, accountId } = await createUserWithAccount(user);
  const { url } = (await (await callBilling(app, "POST", "/api/billing/checkout", { user })).json()) as { url: string };
  await fakeStripe.completeCheckout(url);
  await callBilling(app, "POST", "/api/billing/sync", { user });
  return { userId, accountId };
}

const stripeQuantity = async () => (await fakeStripe.subscriptions())[0]!.items.data[0]!.quantity;
const quantityUpdates = async () =>
  (await fakeStripe.requests()).filter((r) => r.method === "POST" && r.path.startsWith("/v1/subscriptions/"));
const rowOf = async (userId: string) => (await db().select().from(subscriptions).where(eq(subscriptions.userId, userId)))[0]!;
const create = (user: string, name: string) => callBilling(app, "POST", "/api/accounts", { user, body: { name } });

describe("アカウントを作る・削除する", () => {
  it("作ると数が増え、削除すると減る。日割りの請求・返金はしない。0件でも数は1", async () => {
    const { userId, accountId } = await subscribed("u1");
    expect(await stripeQuantity()).toBe(1);
    const res = await create("u1", "2件目");
    expect(res.status).toBe(201);
    expect(await stripeQuantity()).toBe(2);
    const updates = await quantityUpdates();
    expect(updates.at(-1)!.params).toMatchObject({ "items[0][quantity]": "2", proration_behavior: "none" });
    expect(await rowOf(userId)).toMatchObject({ quantity: 2, quantitySyncNeeded: false });

    const second = ((await res.json()) as { id: string; name: string }).id;
    await callBilling(app, "DELETE", `/api/accounts/${second}`, { user: "u1", body: { confirmName: "2件目" } });
    expect(await stripeQuantity()).toBe(1);
    const name = ((await (await callBilling(app, "GET", `/api/accounts/${accountId}`, { user: "u1" })).json()) as { name: string }).name;
    await callBilling(app, "DELETE", `/api/accounts/${accountId}`, { user: "u1", body: { confirmName: name } });
    expect(await stripeQuantity()).toBe(1);
  });

  it("Stripeに届かなくても作成は成功し、印が残る。日次の合わせ直しで数が合い、印が消える", async () => {
    const { userId } = await subscribed("u1");
    await fakeStripe.fail("/v1/subscriptions/", { method: "POST", status: 500 });
    expect((await create("u1", "2件目")).status).toBe(201);
    expect(await stripeQuantity()).toBe(1);
    expect((await rowOf(userId)).quantitySyncNeeded).toBe(true);
    expect(await reconcileSubscriptions(billingEnv())).toEqual({ synced: 1, failed: 0 });
    expect(await stripeQuantity()).toBe(2);
    expect((await rowOf(userId)).quantitySyncNeeded).toBe(false);
  });

  it("契約がない利用者では、Stripeを呼ばない", async () => {
    await createUserWithAccount("u1");
    // 無料体験中は1件までなので、料金なしでない利用者で、作るのと削除を確かめる
    const { accountId } = await createUserWithAccount("u2");
    const name = ((await (await callBilling(app, "GET", `/api/accounts/${accountId}`, { user: "u2" })).json()) as { name: string }).name;
    await callBilling(app, "DELETE", `/api/accounts/${accountId}`, { user: "u2", body: { confirmName: name } });
    expect((await create("u2", "x")).status).toBe(201);
    expect(await fakeStripe.requests()).toHaveLength(0);
  });
});

describe("日次の合わせ直し", () => {
  it("知らせが届かなかった状態の変化（支払いの失敗）を読み直す", async () => {
    const { userId } = await subscribed("u1");
    const customer = (await rowOf(userId)).stripeCustomerId;
    await fakeStripe.setStatus({ customer }, { status: "past_due" });
    await reconcileSubscriptions(billingEnv());
    expect((await rowOf(userId)).status).toBe("past_due");
  });

  it("決済OFFなら何もしない", async () => {
    await subscribed("u1");
    const before = (await fakeStripe.requests()).length;
    expect(await reconcileSubscriptions(testEnv)).toEqual({ synced: 0, failed: 0 });
    expect((await fakeStripe.requests()).length).toBe(before);
  });
});

describe("料金の切り替え（specs/024 research.md R10、T030）", () => {
  it("契約の料金が STRIPE_PRICE_ID と違えば、数の合わせ直しで新しい料金にする（日割りなし）。同じなら替えない", async () => {
    const { userId } = await subscribed("u1");
    expect((await fakeStripe.subscriptions())[0]!.items.data[0]!.price.id).toBe(testEnv.STRIPE_PRICE_ID);
    // 料金が同じで数も合っていれば、Stripeを呼ばない
    const before = (await quantityUpdates()).length;
    await db().update(subscriptions).set({ quantitySyncNeeded: true }).where(eq(subscriptions.userId, userId));
    await reconcileSubscriptions(billingEnv());
    expect((await quantityUpdates()).length).toBe(before);

    // 1件1,000円の新しい料金に替えた環境
    const env = billingEnv({ STRIPE_PRICE_ID: "price_NewPerAccount" });
    expect(await reconcileSubscriptions(env)).toEqual({ synced: 1, failed: 0 });
    expect((await fakeStripe.subscriptions())[0]!.items.data[0]!.price.id).toBe("price_NewPerAccount");
    expect((await quantityUpdates()).at(-1)!.params).toMatchObject({
      "items[0][price]": "price_NewPerAccount",
      "items[0][quantity]": "1",
      proration_behavior: "none",
    });
  });
});

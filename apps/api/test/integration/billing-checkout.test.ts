// 契約する（specs/013-billing FR-021〜FR-025、research.md R4、T025）。決済ON・偽のStripe。
import { trialEndsAt } from "@threads-grower/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions, users } from "../../src/db/schema";
import { call, createUserWithAccount, db, endTrial, insertSubscription, makeApp, resetDb } from "../helpers/app";
import { callBilling, fakeStripe } from "../helpers/billing";
import { TEST_WEB_ORIGIN } from "../env";

const app = makeApp();
const HOUR = 3_600_000;

beforeEach(async () => {
  await resetDb();
  await fakeStripe.reset();
});

const checkout = (user: string) => callBilling(app, "POST", "/api/billing/checkout", { user });

async function sessionParams() {
  const reqs = await fakeStripe.requests();
  return reqs.filter((r) => r.method === "POST" && r.path === "/v1/checkout/sessions").map((r) => r.params);
}

/** 無料体験の残りがちょうど ms になるように、登録日時を合わせる（暦の1か月なので数回で合わせる）。 */
async function setTrialRemaining(userId: string, ms: number) {
  const now = Date.now();
  let created = new Date(now - 30 * 24 * HOUR + ms);
  for (let i = 0; i < 3; i++) created = new Date(created.getTime() + (now + ms - trialEndsAt(created).getTime()));
  await db().update(users).set({ createdAt: created }).where(eq(users.id, userId));
}

describe("POST /api/billing/checkout", () => {
  it("はじめての契約：顧客を1つ作り、Checkoutの要求の形が正しい（無料体験の終わりまで試用）", async () => {
    const { userId } = await createUserWithAccount("u1");
    const res = await checkout("u1");
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/\/checkout\/cs_/);
    const [row] = await db().select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(row).toMatchObject({ status: null, stripeSubscriptionId: null });
    expect(row!.pendingCheckoutSessionId).toMatch(/^cs_/);
    const [p] = await sessionParams();
    expect(p).toMatchObject({
      mode: "subscription",
      customer: row!.stripeCustomerId,
      "line_items[0][price]": "price_TestOnlyTiered",
      "line_items[0][quantity]": "1",
      locale: "ja",
      client_reference_id: userId,
      success_url: `${TEST_WEB_ORIGIN}/settings/billing?checkout=success`,
      cancel_url: `${TEST_WEB_ORIGIN}/settings/billing?checkout=canceled`,
      "subscription_data[proration_behavior]": "none",
    });
    const [u] = await db().select().from(users).where(eq(users.id, userId));
    expect(Number(p!["subscription_data[trial_end]"])).toBe(Math.floor(trialEndsAt(u!.createdAt).getTime() / 1000));
    expect(p!["subscription_data[trial_period_days]"]).toBeUndefined();
    // 2回目でも顧客は増えない
    await checkout("u1");
    expect((await fakeStripe.requests()).filter((r) => r.path === "/v1/customers")).toHaveLength(1);
  });

  it("無料体験の残りが48時間未満なら1日の試用、終わっていれば試用なし（Stripeの制約。research.md R4）", async () => {
    const { userId } = await createUserWithAccount("u1");
    await setTrialRemaining(userId, 30 * HOUR);
    expect((await checkout("u1")).status).toBe(200);
    await endTrial(userId);
    expect((await checkout("u1")).status).toBe(200);
    const [short, ended] = await sessionParams();
    expect(short).toMatchObject({ "subscription_data[trial_period_days]": "1" });
    expect(short!["subscription_data[trial_end]"]).toBeUndefined();
    expect(ended!["subscription_data[trial_end]"]).toBeUndefined();
    expect(ended!["subscription_data[trial_period_days]"]).toBeUndefined();
  });

  it("数はオーナーのアカウントの数（0件でも1）", async () => {
    const { userId } = await createUserWithAccount("u1");
    await createUserWithAccount("u1");
    await createUserWithAccount("u1");
    await endTrial(userId);
    await checkout("u1");
    expect((await sessionParams())[0]).toMatchObject({ "line_items[0][quantity]": "3" });
    await call(app, "GET", "/api/me", { user: "u2" });
    expect((await checkout("u2")).status).toBe(200);
    expect((await sessionParams())[1]).toMatchObject({ "line_items[0][quantity]": "1" });
  });

  it("2回目の「契約する」は、前のセッションを期限切れにしてから作る（開いているセッションは1つ）", async () => {
    await createUserWithAccount("u1");
    await checkout("u1");
    await checkout("u1");
    const sessions = await fakeStripe.sessions();
    expect(sessions.map((s) => s.status)).toEqual(["expired", "open"]);
  });

  it.each([
    ["trialing", false],
    ["active", false],
    ["active", true],
    ["past_due", false],
  ] as const)("契約が %s（解約の予約 %s）なら 409 ALREADY_SUBSCRIBED で、Stripeを呼ばない", async (status, cancelAtPeriodEnd) => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status, cancelAtPeriodEnd });
    const res = await checkout("u1");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ALREADY_SUBSCRIBED");
    expect(await fakeStripe.requests()).toHaveLength(0);
  });

  it("解約して期間が終わった（canceled）人は、もう一度契約でき、試用は付かない", async () => {
    const { userId } = await createUserWithAccount("u1");
    await endTrial(userId);
    await insertSubscription(userId, { status: "canceled", stripeCustomerId: "cus_old", stripeSubscriptionId: "sub_old" });
    await fakeStripe.createSubscription("cus_old", { status: "canceled" });
    expect((await checkout("u1")).status).toBe(200);
    const [p] = await sessionParams();
    expect(p).toMatchObject({ customer: "cus_old" });
    expect(p!["subscription_data[trial_end]"]).toBeUndefined();
  });

  it("契約前の人（024のあとに登録）は、試用なしでその場で請求する（specs/024 FR-030、T029）", async () => {
    // JIT作成（legacy_trial は false）
    expect((await callBilling(app, "GET", "/api/me", { user: "n1" })).status).toBe(200);
    expect((await checkout("n1")).status).toBe(200);
    const [p] = await sessionParams();
    expect(p!["subscription_data[trial_end]"]).toBeUndefined();
    expect(p!["subscription_data[trial_period_days]"]).toBeUndefined();
    expect(p).toMatchObject({ "line_items[0][quantity]": "1" });
  });

  it("Stripeが失敗したら 503 BILLING_UNAVAILABLE で、契約の状態は変わらない", async () => {
    const { userId } = await createUserWithAccount("u1");
    await fakeStripe.fail("/v1/checkout/sessions", { status: 500 });
    const res = await checkout("u1");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BILLING_UNAVAILABLE");
    const [row] = await db().select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(row?.status ?? null).toBeNull();
    expect(row?.pendingCheckoutSessionId ?? null).toBeNull();
  });

  it("決済OFFなら 404", async () => {
    await createUserWithAccount("u1");
    expect((await call(app, "POST", "/api/billing/checkout", { user: "u1" })).status).toBe(404);
  });
});

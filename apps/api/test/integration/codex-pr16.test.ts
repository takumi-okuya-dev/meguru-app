// PR #16 のCodexレビューへの対応（specs/013-billing）。決済ON・偽のStripe。
import { and, eq } from "drizzle-orm";
import { entitlementOf, type SubscriptionStatus } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions, users } from "../../src/db/schema";
import { readGate } from "../../src/apps/threads/publish/auto-post-gate";
import { runAutoPost } from "../../src/apps/threads/publish/auto-post-runner";
import { fullAccessSql, reconcileSubscriptions, syncCustomer } from "../../src/platform/billing/billing-service";
import { call, createUserWithAccount, db, fake, fakeClerk, insertSubscription, makeApp, resetDb, setBillingExempt, testEnv } from "../helpers/app";
import { addMin, connectedAccount, jst, publishedDrafts, setSchedule, db as sqlDb } from "../helpers/auto-post";
import { billingEnv, callBilling, fakeStripe } from "../helpers/billing";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fakeStripe.reset();
  fakeClerk.reset();
});

const rowOf = async (userId: string) => (await db().select().from(subscriptions).where(eq(subscriptions.userId, userId)))[0]!;

async function checkout(user: string) {
  const { url } = (await (await callBilling(app, "POST", "/api/billing/checkout", { user })).json()) as { url: string };
  return url.split("/checkout/")[1]!;
}

describe("P1：日次の合わせ直しに、開いたCheckoutのある行を含める", () => {
  it("Checkoutを終えたのに知らせも読み直しも届かなかった行を、日次で拾って契約中にする", async () => {
    const { userId } = await createUserWithAccount("u1");
    const sessionId = await checkout("u1");
    await fetch(`${testEnv.STRIPE_API_BASE_URL}/__control/complete-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sessionId }),
    });
    expect((await rowOf(userId)).status).toBeNull();
    await reconcileSubscriptions(billingEnv());
    expect(await rowOf(userId)).toMatchObject({ status: "trialing", pendingCheckoutSessionId: null });
  });

  it("期限切れのセッションしかなければ、記録を消して日次の対象から外す。開いている間は残す", async () => {
    const { userId } = await createUserWithAccount("u1");
    const sessionId = await checkout("u1");
    await reconcileSubscriptions(billingEnv());
    expect((await rowOf(userId)).pendingCheckoutSessionId).toBe(sessionId);
    await fetch(`${testEnv.STRIPE_API_BASE_URL}/__control/expire-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sessionId }),
    });
    await reconcileSubscriptions(billingEnv());
    expect((await rowOf(userId)).pendingCheckoutSessionId).toBeNull();
  });
});

describe("P1：契約が戻ったら自動投稿の関所が開く", () => {
  it("読むだけのアカウントの予定も、次に見る時刻に入れる（翌日3時まで閉じない）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await setSchedule(accountId, { slotMinutes: [720] });
    // 2030年の「今」では無料体験が終わっていて、契約もない（読むだけ）
    const env = billingEnv();
    await env.AUTOPOST_KV.delete("autopost:gate");
    const now = jst("2030-01-10 10:00");
    await runAutoPost(env, now, undefined, () => now);
    const gate = await readGate(env.AUTOPOST_KV);
    expect(new Date(gate.gate!.nextCheckAt).getTime()).toBeLessThanOrEqual(addMin(jst("2030-01-10 12:00"), 10).getTime());
  });
});

describe("P1：決済OFFでも、退会のときに今の契約を止める", () => {
  it("OFFに切り替えた環境で、契約の記録があればStripeで止める", async () => {
    const { userId } = await createUserWithAccount("u1");
    await checkout("u1");
    const sub = await fakeStripe.createSubscription((await rowOf(userId)).stripeCustomerId, { status: "active" });
    await insertSubscription(userId, { status: "active", stripeCustomerId: (await rowOf(userId)).stripeCustomerId, stripeSubscriptionId: sub.id });
    const res = await call(app, "POST", "/api/me/withdraw", { user: "u1", body: { confirmEmail: "u1@example.com" } });
    expect(res.status).toBe(204);
    expect((await fakeStripe.subscriptions()).find((s) => s.id === sub.id)!.status).toBe("canceled");
  });

  it("止められない（鍵がない）なら 503 で、データと契約の記録を残す", async () => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "active" });
    const env = { ...testEnv, STRIPE_SECRET_KEY: undefined } as unknown as typeof testEnv;
    const res = await call(app, "POST", "/api/me/withdraw", { user: "u1", body: { confirmEmail: "u1@example.com" }, env });
    expect(res.status).toBe(503);
    expect(await db().select().from(users).where(eq(users.id, userId))).toHaveLength(1);
    expect(await db().select().from(subscriptions)).toHaveLength(1);
  });

  it("決済OFFで契約の記録がなければ、Stripeを呼ばずに退会できる", async () => {
    await createUserWithAccount("u1");
    const env = { ...testEnv, STRIPE_SECRET_KEY: undefined } as unknown as typeof testEnv;
    expect((await call(app, "POST", "/api/me/withdraw", { user: "u1", body: { confirmEmail: "u1@example.com" }, env })).status).toBe(204);
  });
});

describe("P1：重複した契約では、使える契約を残す", () => {
  it("古い incomplete と新しい active があれば、active を残して incomplete を止める", async () => {
    const { userId } = await createUserWithAccount("u1");
    await checkout("u1");
    const customer = (await rowOf(userId)).stripeCustomerId;
    const old = await fakeStripe.createSubscription(customer, { status: "incomplete" });
    const good = await fakeStripe.createSubscription(customer, { status: "active" });
    await syncCustomer(billingEnv(), customer);
    expect(await rowOf(userId)).toMatchObject({ stripeSubscriptionId: good.id, status: "active" });
    expect((await fakeStripe.subscriptions()).find((s) => s.id === old.id)!.status).toBe("canceled");
  });
});

describe("P1：読むだけの候補を、件数の上限の前に外す（SQLの条件が entitlementOf と同じ）", () => {
  it.each([
    [null, false, 10],
    [null, false, 40],
    ["trialing", false, 40],
    ["active", false, 40],
    ["active", false, 10],
    ["past_due", false, 10],
    ["unpaid", false, 10],
    ["paused", false, 10],
    ["canceled", false, 10],
    ["canceled", false, 40],
    ["incomplete", false, 10],
    ["incomplete_expired", false, 40],
    ["past_due", true, 40],
  ] as const)("契約 %s・料金なし %s・登録から%d日", async (status, exempt, daysAgo) => {
    // 024の前からいた人（legacy_trial）と、024のあとの人（契約前）の両方で、SQLと関数の結果が同じ（specs/024 T029）
    for (const legacy of [true, false]) {
    await resetDb();
    const now = new Date();
    const created = new Date(now.getTime() - daysAgo * 86_400_000);
    const { userId } = await createUserWithAccount("u1", { userCreatedAt: created });
    await db().update(users).set({ legacyTrial: legacy }).where(eq(users.id, userId));
    if (status) await insertSubscription(userId, { status });
    if (exempt) await setBillingExempt(userId, true);
    const mode = { enabled: true };
    const rows = await db()
      .select({ id: users.id })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(and(eq(users.id, userId), fullAccessSql(mode, now)));
    const expected = entitlementOf({
      billingEnabled: true,
      exempt,
      userCreatedAt: created,
      subscription: status ? { status: status as SubscriptionStatus, cancelAtPeriodEnd: false } : null,
      now,
      legacyTrial: legacy,
    }).fullAccess;
    expect(rows.length === 1, `legacy ${legacy}`).toBe(expected);
    }
  });

  it("月末の登録（1月31日）は2月の最終日まで（Postgres の1か月の丸めと同じ）", async () => {
    const created = new Date("2027-01-31T03:00:00.000Z");
    const { userId } = await createUserWithAccount("u1", { userCreatedAt: created });
    for (const [at, full] of [
      ["2027-02-28T02:59:00.000Z", true],
      ["2027-02-28T03:00:00.000Z", false],
    ] as const) {
      const rows = await db()
        .select({ id: users.id })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(and(eq(users.id, userId), fullAccessSql({ enabled: true }, new Date(at))));
      expect(rows.length === 1, at).toBe(full);
    }
  });

  it("読むだけの投稿が上限より多くても、契約中のアカウントの反応数を取る", async () => {
    const NOON = jst("2030-01-10 12:00");
    const ro = await connectedAccount("ro", app);
    const roOwner = ((await sqlDb()`SELECT user_id FROM memberships WHERE account_id = ${ro.accountId}`) as [{ user_id: string }])[0].user_id;
    // 定期処理の「今」から10日前の登録で、支払いの失敗（大まかな条件なら入ってしまう）
    await sqlDb()`UPDATE users SET created_at = ${new Date(NOON.getTime() - 10 * 86_400_000).toISOString()} WHERE id = ${roOwner}`;
    await insertSubscription(roOwner, { status: "past_due" });
    // 1回の登録は50件までなので、2回に分ける
    for (let i = 0; i < 2; i++) {
      await publishedDrafts(ro.accountId, Array.from({ length: 35 }, () => ({ publishedAt: new Date(NOON.getTime() - 24 * 3_600_000) })));
    }
    const ok = await connectedAccount("ok", app);
    const okOwner = ((await sqlDb()`SELECT user_id FROM memberships WHERE account_id = ${ok.accountId}`) as [{ user_id: string }])[0].user_id;
    await setBillingExempt(okOwner, true);
    await publishedDrafts(ok.accountId, [{ publishedAt: new Date(NOON.getTime() - 23.5 * 3_600_000) }]);
    const env = billingEnv();
    await env.AUTOPOST_KV.delete("autopost:gate");
    await env.AUTOPOST_KV.put("autopost:catchup", "2030-01-10");
    await runAutoPost(env, NOON, undefined, () => NOON);
    expect((await fake.callCounts()).insights).toBe(1);
  });
});

describe("P2：同時の読み直し・数の反映", () => {
  it("顧客の読み直しを同時に何度走らせても、最後はStripeの今の状態になる", async () => {
    const { userId } = await createUserWithAccount("u1");
    await checkout("u1");
    const customer = (await rowOf(userId)).stripeCustomerId;
    await fakeStripe.createSubscription(customer, { status: "active" });
    await Promise.all(Array.from({ length: 4 }, () => syncCustomer(billingEnv(), customer)));
    await fakeStripe.setStatus({ customer }, { status: "past_due" });
    await Promise.all(Array.from({ length: 4 }, () => syncCustomer(billingEnv(), customer)));
    expect((await rowOf(userId)).status).toBe("past_due");
  });

  it("アカウントを同時に作っても、Stripeの数は最後の件数になり、印が消える", async () => {
    const { userId } = await createUserWithAccount("u1");
    // 4件まで作れるようにする（上限の既定値は3件。specs/024）
    await db().update(users).set({ accountLimit: 10 }).where(eq(users.id, userId));
    const { url } = (await (await callBilling(app, "POST", "/api/billing/checkout", { user: "u1" })).json()) as { url: string };
    await fakeStripe.completeCheckout(url);
    await callBilling(app, "POST", "/api/billing/sync", { user: "u1" });
    await Promise.all(["2", "3", "4"].map((name) => callBilling(app, "POST", "/api/accounts", { user: "u1", body: { name } })));
    expect((await fakeStripe.subscriptions())[0]!.items.data[0]!.quantity).toBe(4);
    expect(await rowOf(userId)).toMatchObject({ quantity: 4, quantitySyncNeeded: false });
  });
});

describe("P2（2回目）：契約の一覧をすべてのページから読む", () => {
  it("新しい12件の後ろにある古い有効な契約も、読み直しと退会で扱う", async () => {
    const { userId } = await createUserWithAccount("u1");
    await checkout("u1");
    const customer = (await rowOf(userId)).stripeCustomerId;
    const oldLive = await fakeStripe.createSubscription(customer, { status: "active" });
    for (let i = 0; i < 12; i++) await fakeStripe.createSubscription(customer, { status: "canceled" });
    // 1ページ5件にして、ページ分けを確かめる
    await fetch(`${testEnv.STRIPE_API_BASE_URL}/__control/page-limit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 5 }),
    });
    await syncCustomer(billingEnv(), customer);
    expect(await rowOf(userId)).toMatchObject({ stripeSubscriptionId: oldLive.id, status: "active" });
    expect((await callBilling(app, "POST", "/api/me/withdraw", { user: "u1", body: { confirmEmail: "u1@example.com" } })).status).toBe(204);
    expect((await fakeStripe.subscriptions()).find((s) => s.id === oldLive.id)!.status).toBe("canceled");
  });
});

describe("P1（3回目）：退会を受け付けた後は、Checkoutを作らない", () => {
  it("退会の途中の利用者の「契約する」は 409 WITHDRAWAL_IN_PROGRESS で、セッションを作らない", async () => {
    const { userId } = await createUserWithAccount("u1");
    await db().update(users).set({ withdrawalRequestedAt: new Date() }).where(eq(users.id, userId));
    const { startCheckout } = await import("../../src/platform/billing/billing-service");
    const err = await startCheckout(billingEnv(), { id: userId, email: "u1@example.com", billing: { enabled: true } }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "WITHDRAWAL_IN_PROGRESS", status: 409 });
    expect(await fakeStripe.sessions()).toHaveLength(0);
  });
});

describe("P1（4回目）：知らせが届かなかった完了済みのCheckoutがあれば、2つ目を作らない", () => {
  it("「契約する」の前にStripeを読み直し、契約中なら 409 ALREADY_SUBSCRIBED で、新しいセッションを作らない", async () => {
    const { userId } = await createUserWithAccount("u1");
    const sessionId = await checkout("u1");
    await fetch(`${testEnv.STRIPE_API_BASE_URL}/__control/complete-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sessionId }),
    });
    const res = await callBilling(app, "POST", "/api/billing/checkout", { user: "u1" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ALREADY_SUBSCRIBED");
    expect(await fakeStripe.sessions()).toHaveLength(1);
    expect((await rowOf(userId)).status).toBe("trialing");
  });
});

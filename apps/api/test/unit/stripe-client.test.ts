// Stripeのクライアント（specs/013-billing research.md R5）。要求の形と、Webhookの署名の確認
import { describe, expect, it } from "vitest";
import {
  createStripeClient,
  encodeForm,
  periodEndOf,
  signWebhook,
  STRIPE_API_VERSION,
  StripeError,
  verifyWebhookSignature,
} from "../../src/adapters/stripe/stripe-client";

type Captured = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, captured: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const env = { STRIPE_SECRET_KEY: "sk_test_secret123456", STRIPE_API_BASE_URL: "http://stripe.test" };

describe("encodeForm", () => {
  it("入れ子・配列・日時を a[b][0] の形にする", () => {
    const f = encodeForm({
      mode: "subscription",
      line_items: [{ price: "price_1", quantity: 2 }],
      subscription_data: { trial_end: new Date("2026-11-01T03:00:00.000Z"), default_tax_rates: ["txr_1"] },
      skip: undefined,
    });
    expect([...f]).toEqual([
      ["mode", "subscription"],
      ["line_items[0][price]", "price_1"],
      ["line_items[0][quantity]", "2"],
      ["subscription_data[trial_end]", "1793502000"],
      ["subscription_data[default_tax_rates][0]", "txr_1"],
    ]);
  });
});

describe("createStripeClient", () => {
  it("Checkout：鍵・版・本文の形と、試用・数", async () => {
    const captured: Captured[] = [];
    const stripe = createStripeClient(env, fakeFetch(200, { id: "cs_1", url: "https://checkout" }, captured));
    const res = await stripe.createCheckoutSession({
      customer: "cus_1",
      priceId: "price_1",
      quantity: 3,
      userId: "u1",
      successUrl: "http://web/s",
      cancelUrl: "http://web/c",
      trialPeriodDays: 1,
    });
    expect(res.url).toBe("https://checkout");
    const { url, init } = captured[0]!;
    expect(url).toBe("http://stripe.test/v1/checkout/sessions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_secret123456");
    expect(headers["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][quantity]")).toBe("3");
    expect(body.get("locale")).toBe("ja");
    expect(body.get("client_reference_id")).toBe("u1");
    expect(body.get("subscription_data[proration_behavior]")).toBe("none");
    expect(body.get("subscription_data[trial_period_days]")).toBe("1");
    expect(body.get("subscription_data[trial_end]")).toBeNull();
  });

  it("顧客は冪等キーを付けて作る", async () => {
    const captured: Captured[] = [];
    const stripe = createStripeClient(env, fakeFetch(200, { id: "cus_1" }, captured));
    await stripe.createCustomer({ userId: "u1", email: "a@example.com" }, "customer-u1");
    expect((captured[0]!.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("customer-u1");
    expect(new URLSearchParams(String(captured[0]!.init.body)).get("metadata[user_id]")).toBe("u1");
  });

  it("数の変更は日割りなし、一覧はクエリで送る", async () => {
    const captured: Captured[] = [];
    const stripe = createStripeClient(env, fakeFetch(200, { data: [] }, captured));
    await stripe.updateSubscriptionQuantity("sub_1", "si_1", 2);
    const body = new URLSearchParams(String(captured[0]!.init.body));
    expect(body.get("items[0][id]")).toBe("si_1");
    expect(body.get("items[0][quantity]")).toBe("2");
    expect(body.get("proration_behavior")).toBe("none");
    await stripe.listSubscriptions("cus_1");
    expect(captured[1]!.url).toBe("http://stripe.test/v1/subscriptions?customer=cus_1&status=all&limit=100");
    expect(captured[1]!.init.body).toBeUndefined();
  });

  it("契約の一覧は has_more の間、starting_after で次のページを読む（PR #16 のCodexレビュー）", async () => {
    const captured: Captured[] = [];
    const pages = [
      { data: [{ id: "sub_3" }, { id: "sub_2" }], has_more: true },
      { data: [{ id: "sub_1" }], has_more: false },
    ];
    const stripe = createStripeClient(env, (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(pages[captured.length - 1]), { status: 200 });
    }) as typeof fetch);
    const all = await stripe.listSubscriptions("cus_1");
    expect(all.map((s) => s.id)).toEqual(["sub_3", "sub_2", "sub_1"]);
    expect(captured[1]!.url).toContain("starting_after=sub_2");
  });

  it("誤りは StripeError にし、鍵を文に含めない", async () => {
    const stripe = createStripeClient(env, fakeFetch(404, { error: { code: "resource_missing" } }, []));
    const err = await stripe.cancelSubscription("sub_x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(err).toMatchObject({ status: 404, code: "resource_missing" });
    expect(String((err as Error).message)).not.toContain("sk_test");
    const down = createStripeClient(env, (async () => {
      throw new TypeError("network");
    }) as typeof fetch);
    await expect(down.listSubscriptions("cus_1")).rejects.toMatchObject({ status: 0 });
  });

  it("期間の終わりは契約の項目から読み、なければ契約から読む", () => {
    const base = { id: "sub", status: "active", customer: "cus", created: 0, cancel_at_period_end: false, cancel_at: null, trial_end: null };
    expect(periodEndOf({ ...base, items: { data: [{ id: "si", current_period_end: 1793502000 }] } })?.toISOString()).toBe(
      "2026-11-01T03:00:00.000Z",
    );
    expect(periodEndOf({ ...base, current_period_end: 1793502000, items: { data: [{ id: "si" }] } })?.toISOString()).toBe(
      "2026-11-01T03:00:00.000Z",
    );
    expect(periodEndOf({ ...base, items: { data: [] } })).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_TestSecret0000";
  const now = new Date("2026-10-15T00:00:00.000Z");
  const body = '{"id":"evt_1"}';

  it("正しい署名なら true、本文・秘密が違えば false", async () => {
    const header = await signWebhook(body, secret, now);
    expect(await verifyWebhookSignature(body, header, secret, now)).toBe(true);
    expect(await verifyWebhookSignature(`${body} `, header, secret, now)).toBe(false);
    expect(await verifyWebhookSignature(body, header, "whsec_Other000000", now)).toBe(false);
  });

  it("5分より古い・先の署名は false", async () => {
    const header = await signWebhook(body, secret, new Date(now.getTime() - 301_000));
    expect(await verifyWebhookSignature(body, header, secret, now)).toBe(false);
    const ok = await signWebhook(body, secret, new Date(now.getTime() - 299_000));
    expect(await verifyWebhookSignature(body, ok, secret, now)).toBe(true);
  });

  it("v1 が複数あれば、どれかが合えばよい。形の誤りは false", async () => {
    const header = await signWebhook(body, secret, now);
    const t = header.split(",")[0];
    const v1 = header.split(",")[1];
    expect(await verifyWebhookSignature(body, `${t},v1=deadbeef,${v1}`, secret, now)).toBe(true);
    expect(await verifyWebhookSignature(body, null, secret, now)).toBe(false);
    expect(await verifyWebhookSignature(body, "v1=abc", secret, now)).toBe(false);
    expect(await verifyWebhookSignature(body, `${t}`, secret, now)).toBe(false);
  });
});

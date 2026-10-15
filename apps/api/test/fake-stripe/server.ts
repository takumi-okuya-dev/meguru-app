// 偽のStripe（specs/013-billing research.md R5）。Node で動かし、結合テスト・E2E・ローカル確認で使う。
// - API：顧客・Checkoutのセッション（作る・期限切れ）・カスタマーポータル・契約の一覧・数の変更・契約を止める
// - Checkoutの画面：/checkout/:id を開くと、すぐに契約を作って success_url へ戻す（設定されていればWebhookも送る）
// - 制御用：/__control/*（初期化、受けた要求の一覧、契約の状態の変更、失敗の注入、Webhookの送り先と送信）
import { Hono, type Context } from "hono";
import { signWebhook } from "../../src/lib/stripe-client";

type Session = {
  id: string;
  customer: string;
  quantity: number;
  status: "open" | "complete" | "expired";
  successUrl: string;
  cancelUrl: string;
  trialEnd: number | null;
  trialPeriodDays: number | null;
  userId: string | null;
};
type Subscription = {
  id: string;
  customer: string;
  status: string;
  created: number;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  trial_end: number | null;
  items: { data: { id: string; quantity: number; current_period_end: number }[] };
};
type Recorded = { method: string; path: string; params: Record<string, string> };

const DAY = 86_400;

export function createFakeStripe() {
  const customers = new Map<string, { id: string; email: string; userId: string }>();
  const idempotency = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const subscriptions = new Map<string, Subscription>();
  const requests: Recorded[] = [];
  // パスの前方一致ごとの、次の n 回の失敗（status）
  const failures: { prefix: string; method: string; times: number; status: number }[] = [];
  let webhook: { url: string; secret: string } | null = null;
  let seq = 0;
  let clock = 0; // 契約の created を必ず増やす
  const id = (prefix: string) => `${prefix}_fake${++seq}`;
  const now = () => Math.floor(Date.now() / 1000);

  const app = new Hono();

  async function params(c: Context): Promise<Record<string, string>> {
    if (c.req.method === "GET" || c.req.method === "DELETE") return Object.fromEntries(new URL(c.req.url).searchParams);
    const text = await c.req.text();
    return Object.fromEntries(new URLSearchParams(text));
  }

  function stripeError(c: Context, status: number, code: string) {
    return c.json({ error: { code, type: "invalid_request_error", message: code } }, status as 400);
  }

  async function sendWebhook(type: string, object: unknown) {
    if (!webhook) return;
    const body = JSON.stringify({ id: id("evt"), type, created: now(), data: { object } });
    await fetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": await signWebhook(body, webhook.secret, new Date()) },
      body,
    }).catch(() => undefined);
  }

  function createSubscription(customer: string, quantity: number, opts: { status?: string; trialEnd?: number | null } = {}) {
    const trialEnd = opts.trialEnd ?? null;
    const sub: Subscription = {
      id: id("sub"),
      customer,
      status: opts.status ?? (trialEnd ? "trialing" : "active"),
      created: now() + ++clock,
      cancel_at_period_end: false,
      cancel_at: null,
      trial_end: trialEnd,
      items: { data: [{ id: id("si"), quantity, current_period_end: trialEnd ?? now() + 30 * DAY }] },
    };
    subscriptions.set(sub.id, sub);
    return sub;
  }

  // ---- API（/v1）。鍵と失敗の注入、要求の記録 ----
  app.use("/v1/*", async (c, next) => {
    if (!c.req.header("Authorization")?.startsWith("Bearer sk_test_")) return stripeError(c, 401, "invalid_api_key");
    const p = await params(c);
    requests.push({ method: c.req.method, path: c.req.path, params: p });
    c.set("params" as never, p as never);
    const f = failures.find((x) => x.times > 0 && x.method === c.req.method && c.req.path.startsWith(x.prefix));
    if (f) {
      f.times -= 1;
      return stripeError(c, f.status, "injected_failure");
    }
    return next();
  });
  const p = (c: Context) => c.get("params" as never) as Record<string, string>;

  app.post("/v1/customers", (c) => {
    const key = c.req.header("Idempotency-Key");
    if (key && idempotency.has(key)) return c.json(customers.get(idempotency.get(key)!));
    const customer = { id: id("cus"), email: p(c).email ?? "", userId: p(c)["metadata[user_id]"] ?? "" };
    customers.set(customer.id, customer);
    if (key) idempotency.set(key, customer.id);
    return c.json(customer);
  });

  app.post("/v1/checkout/sessions", (c) => {
    const q = p(c);
    if (!customers.has(q.customer ?? "")) return stripeError(c, 400, "resource_missing");
    const trialEnd = q["subscription_data[trial_end]"] ? Number(q["subscription_data[trial_end]"]) : null;
    if (trialEnd !== null && trialEnd < now() + 48 * 3600) return stripeError(c, 400, "trial_end_too_soon");
    const s: Session = {
      id: id("cs"),
      customer: q.customer!,
      quantity: Number(q["line_items[0][quantity]"] ?? 1),
      status: "open",
      successUrl: q.success_url ?? "",
      cancelUrl: q.cancel_url ?? "",
      trialEnd,
      trialPeriodDays: q["subscription_data[trial_period_days]"] ? Number(q["subscription_data[trial_period_days]"]) : null,
      userId: q.client_reference_id ?? null,
    };
    sessions.set(s.id, s);
    return c.json({ id: s.id, url: `${new URL(c.req.url).origin}/checkout/${s.id}` });
  });

  app.post("/v1/checkout/sessions/:id/expire", (c) => {
    const s = sessions.get(c.req.param("id"));
    if (!s) return stripeError(c, 404, "resource_missing");
    if (s.status !== "open") return stripeError(c, 400, "checkout_session_not_open");
    s.status = "expired";
    return c.json({ id: s.id, status: "expired" });
  });

  app.post("/v1/billing_portal/sessions", (c) => {
    const q = p(c);
    if (!customers.has(q.customer ?? "")) return stripeError(c, 400, "resource_missing");
    return c.json({ url: `${new URL(c.req.url).origin}/portal/${q.customer}?return=${encodeURIComponent(q.return_url ?? "")}` });
  });

  app.get("/v1/subscriptions", (c) => {
    const customer = p(c).customer;
    const data = [...subscriptions.values()].filter((s) => s.customer === customer).sort((a, b) => b.created - a.created);
    return c.json({ object: "list", data });
  });

  app.post("/v1/subscriptions/:id", (c) => {
    const sub = subscriptions.get(c.req.param("id"));
    if (!sub) return stripeError(c, 404, "resource_missing");
    const q = p(c);
    const item = sub.items.data.find((i) => i.id === q["items[0][id]"]);
    if (!item) return stripeError(c, 400, "resource_missing");
    if (q["items[0][quantity]"]) item.quantity = Number(q["items[0][quantity]"]);
    return c.json(sub);
  });

  app.delete("/v1/subscriptions/:id", (c) => {
    const sub = subscriptions.get(c.req.param("id"));
    if (!sub) return stripeError(c, 404, "resource_missing");
    sub.status = "canceled";
    return c.json(sub);
  });

  // ---- Checkoutの画面（すぐに完了する） ----
  app.get("/checkout/:id", async (c) => {
    const s = sessions.get(c.req.param("id"));
    if (!s || s.status !== "open") return c.text("このセッションは使えません", 410);
    const trialEnd = s.trialEnd ?? (s.trialPeriodDays ? now() + s.trialPeriodDays * DAY : null);
    const sub = createSubscription(s.customer, s.quantity, { trialEnd });
    s.status = "complete";
    await sendWebhook("checkout.session.completed", { id: s.id, customer: s.customer, subscription: sub.id });
    return c.redirect(s.successUrl, 302);
  });

  app.get("/portal/:customer", (c) => c.html(`<p>偽のカスタマーポータル（${c.req.param("customer")}）</p>`));

  // ---- 制御用 ----
  app.post("/__control/reset", (c) => {
    customers.clear();
    idempotency.clear();
    sessions.clear();
    subscriptions.clear();
    requests.length = 0;
    failures.length = 0;
    webhook = null;
    return c.json({ ok: true });
  });
  app.get("/__control/requests", (c) => c.json({ requests }));
  app.get("/__control/sessions", (c) => c.json({ sessions: [...sessions.values()] }));
  app.get("/__control/subscriptions", (c) => c.json({ subscriptions: [...subscriptions.values()] }));
  app.post("/__control/fail", async (c) => {
    const b = await c.req.json<{ prefix: string; method?: string; times?: number; status?: number }>();
    failures.push({ prefix: b.prefix, method: b.method ?? "POST", times: b.times ?? 1, status: b.status ?? 500 });
    return c.json({ ok: true });
  });
  // 契約を直接作る（Checkoutを通さない）
  app.post("/__control/subscriptions", async (c) => {
    const b = await c.req.json<{ customer: string; quantity?: number; status?: string; trialEnd?: number | null }>();
    if (!customers.has(b.customer)) customers.set(b.customer, { id: b.customer, email: "", userId: "" });
    return c.json(createSubscription(b.customer, b.quantity ?? 1, { status: b.status, trialEnd: b.trialEnd ?? null }));
  });
  // 契約の状態を変える（支払いの失敗・解約の予約・期間の終わり）。webhook を指定すれば送る
  app.post("/__control/subscription-status", async (c) => {
    const b = await c.req.json<{
      id?: string;
      customer?: string;
      status?: string;
      cancelAtPeriodEnd?: boolean;
      currentPeriodEnd?: number;
      webhook?: string;
    }>();
    const sub = b.id
      ? subscriptions.get(b.id)
      : [...subscriptions.values()].filter((s) => s.customer === b.customer).sort((x, y) => y.created - x.created)[0];
    if (!sub) return c.json({ error: "not found" }, 404);
    if (b.status) sub.status = b.status;
    if (b.cancelAtPeriodEnd !== undefined) sub.cancel_at_period_end = b.cancelAtPeriodEnd;
    if (b.currentPeriodEnd !== undefined) sub.items.data[0]!.current_period_end = b.currentPeriodEnd;
    if (b.webhook) await sendWebhook(b.webhook, sub);
    return c.json(sub);
  });
  app.post("/__control/webhook", async (c) => {
    webhook = await c.req.json<{ url: string; secret: string }>();
    return c.json({ ok: true });
  });

  return app;
}

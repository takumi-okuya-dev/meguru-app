// 決済のテストの部品（specs/013-billing tasks.md）：決済ONの環境、偽のStripeの操作、署名つきのWebhook
import type { Env } from "../../src/env";
import { signWebhook } from "../../src/lib/stripe-client";
import { TEST_STRIPE_WEBHOOK_SECRET } from "../env";
import { call, testEnv, type TestApp } from "./app";

/** 決済ONの環境（偽のStripeにつなぐ）。 */
export function billingEnv(over: Partial<Env> = {}): Env {
  return { ...testEnv, BILLING_ENABLED: "true", ...over } as Env;
}

/** 決済ONの環境で API を呼ぶ。 */
export function callBilling(
  app: TestApp,
  method: string,
  path: string,
  opts: { user?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return call(app, method, path, { ...opts, env: billingEnv() });
}

async function control(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${testEnv.STRIPE_API_BASE_URL}/__control/${path}`, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`fake stripe control ${path} failed: ${res.status}`);
  return res.json() as Promise<unknown>;
}

export type FakeStripeSubscription = {
  id: string;
  customer: string;
  status: string;
  created: number;
  cancel_at_period_end: boolean;
  trial_end: number | null;
  items: { data: { id: string; quantity: number; current_period_end: number }[] };
};
export type FakeStripeRequest = { method: string; path: string; params: Record<string, string> };

/** 偽のStripeの操作。 */
export const fakeStripe = {
  reset: () => control("reset", { body: {} }),
  requests: async () => ((await control("requests")) as { requests: FakeStripeRequest[] }).requests,
  sessions: async () =>
    ((await control("sessions")) as { sessions: { id: string; status: string; customer: string; quantity: number }[] }).sessions,
  subscriptions: async () => ((await control("subscriptions")) as { subscriptions: FakeStripeSubscription[] }).subscriptions,
  fail: (prefix: string, opts: { method?: string; times?: number; status?: number } = {}) =>
    control("fail", { body: { prefix, ...opts } }),
  createSubscription: async (customer: string, opts: { quantity?: number; status?: string; trialEnd?: number | null } = {}) =>
    (await control("subscriptions", { body: { customer, ...opts } })) as FakeStripeSubscription,
  setStatus: async (
    target: { id?: string; customer?: string },
    values: { status?: string; cancelAtPeriodEnd?: boolean; currentPeriodEnd?: number },
  ) => (await control("subscription-status", { body: { ...target, ...values } })) as FakeStripeSubscription,
  /** Checkoutの画面を開いたことにする（契約ができ、success_url への戻り先を返す） */
  completeCheckout: async (url: string) => {
    const res = await fetch(url, { redirect: "manual" });
    return { status: res.status, location: res.headers.get("Location") };
  },
};

/**
 * 署名つきのWebhookを送る。
 * @param app - アプリ
 * @param event - 知らせ（type と data.object）
 * @param opts - secret：署名の秘密（既定はテストの秘密）、at：署名の時刻、signature：署名をそのまま指定
 * @returns 応答
 */
export async function sendWebhook(
  app: TestApp,
  event: { id?: string; type: string; data: { object: Record<string, unknown> } },
  opts: { secret?: string; at?: Date; signature?: string | null } = {},
) {
  const body = JSON.stringify({ id: event.id ?? `evt_${crypto.randomUUID()}`, created: Math.floor(Date.now() / 1000), ...event });
  const signature =
    opts.signature !== undefined ? opts.signature : await signWebhook(body, opts.secret ?? TEST_STRIPE_WEBHOOK_SECRET, opts.at ?? new Date());
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["Stripe-Signature"] = signature;
  return app.request("/api/stripe/webhook", { method: "POST", headers, body }, billingEnv());
}

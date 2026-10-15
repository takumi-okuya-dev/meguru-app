// Stripeとのやり取り（specs/013-billing research.md R5）。公式のSDKは使わず、使う7つの呼び出しだけを fetch で持つ。
// 鍵とWebhookの秘密は、例外の文・ログに出さない。接続先は STRIPE_API_BASE_URL（テストと手元は偽のStripe）。
import type { Env } from "../env";

/** 固定するStripeのAPIのバージョン。期間の終わりは契約の項目（items）に置かれる版。 */
export const STRIPE_API_VERSION = "2025-03-31.basil";
const DEFAULT_BASE_URL = "https://api.stripe.com";
/** Webhookの署名の時刻の差の許容（秒）。 */
const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Stripeが誤りを返した・つながらなかった。 */
export class StripeError extends Error {
  override name = "StripeError";
  constructor(
    /** HTTPの状態。つながらなかったときは 0 */
    readonly status: number,
    /** Stripeのエラーの code（resource_missing など） */
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Stripeの契約（使う項目だけ）。 */
export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  created: number;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  trial_end: number | null;
  /** 古い版のAPIの置き場所（偽のStripe・前の版との互換のため読む） */
  current_period_end?: number;
  items: { data: { id: string; quantity?: number; current_period_end?: number }[] };
};

/** Checkoutのセッションを作る要求。 */
export type CheckoutParams = {
  customer: string;
  priceId: string;
  quantity: number;
  userId: string;
  successUrl: string;
  cancelUrl: string;
  trialEnd?: Date;
  trialPeriodDays?: number;
  taxRateId?: string;
};

/** Stripeのクライアント（テストでは偽のStripeに向ける）。 */
export type StripeClient = ReturnType<typeof createStripeClient>;

type Params = Record<string, unknown>;

/**
 * 入れ子のパラメータを application/x-www-form-urlencoded に直す（a[b][0]=… の形）。
 * @param params - パラメータ
 * @param prefix - 入れ子の前置き
 * @param out - 足していく先
 * @returns エンコードしたパラメータ
 */
export function encodeForm(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") encodeForm(v as Params, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(v));
      });
    } else if (typeof value === "object" && !(value instanceof Date)) {
      encodeForm(value as Params, name, out);
    } else {
      out.append(name, value instanceof Date ? String(Math.floor(value.getTime() / 1000)) : String(value));
    }
  }
  return out;
}

/**
 * Stripeのクライアントを作る。
 * @param env - Workers のバインディング（STRIPE_SECRET_KEY・STRIPE_API_BASE_URL）
 * @param fetchImpl - fetch（テストで差し替える）
 * @returns Stripeの呼び出し
 */
export function createStripeClient(
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE_URL">,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
) {
  const base = (env.STRIPE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
    const form = encodeForm(params);
    const url = method === "GET" && [...form].length ? `${base}${path}?${form}` : `${base}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY ?? ""}`,
      "Stripe-Version": STRIPE_API_VERSION,
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let body: string | undefined;
    if (method !== "GET") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = form.toString();
    }
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body });
    } catch {
      throw new StripeError(0, undefined, `stripe unreachable: ${method} ${path}`);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; type?: string } };
    if (!res.ok) {
      throw new StripeError(res.status, json.error?.code ?? json.error?.type, `stripe error ${res.status}: ${method} ${path}`);
    }
    return json as T;
  }

  return {
    /**
     * 顧客を作る。冪等キーで、同じ利用者に2つ作らない。
     * @param input - 利用者のIDとメールアドレス
     * @param idempotencyKey - 冪等キー
     * @returns 顧客
     */
    createCustomer(input: { userId: string; email: string }, idempotencyKey: string) {
      return request<{ id: string }>("POST", "/v1/customers", { email: input.email, metadata: { user_id: input.userId } }, idempotencyKey);
    },
    /**
     * Checkoutのセッションを作る（research.md R4）。
     * @param p - 顧客・料金・数・戻り先・試用
     * @returns セッションのIDとURL
     */
    createCheckoutSession(p: CheckoutParams) {
      const subscriptionData: Params = { proration_behavior: "none", metadata: { user_id: p.userId } };
      if (p.trialEnd) subscriptionData.trial_end = p.trialEnd;
      if (p.trialPeriodDays) subscriptionData.trial_period_days = p.trialPeriodDays;
      if (p.taxRateId) subscriptionData.default_tax_rates = [p.taxRateId];
      return request<{ id: string; url: string }>("POST", "/v1/checkout/sessions", {
        mode: "subscription",
        customer: p.customer,
        line_items: [{ price: p.priceId, quantity: p.quantity }],
        locale: "ja",
        client_reference_id: p.userId,
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
        subscription_data: subscriptionData,
      });
    },
    /**
     * 開いているCheckoutのセッションを期限切れにする。
     * @param id - セッションのID
     * @returns セッション
     */
    expireCheckoutSession(id: string) {
      return request<{ id: string; status: string }>("POST", `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`);
    },
    /**
     * カスタマーポータルのセッションを作る（research.md R7）。
     * @param input - 顧客・戻り先・設定
     * @returns ポータルのURL
     */
    createPortalSession(input: { customer: string; returnUrl: string; configuration?: string }) {
      return request<{ url: string }>("POST", "/v1/billing_portal/sessions", {
        customer: input.customer,
        return_url: input.returnUrl,
        configuration: input.configuration || undefined,
      });
    },
    /**
     * 顧客の契約の一覧（終わったものを含む）。
     * @param customerId - 顧客のID
     * @returns 契約の一覧（新しい順）
     */
    async listSubscriptions(customerId: string) {
      const res = await request<{ data: StripeSubscription[] }>("GET", "/v1/subscriptions", {
        customer: customerId,
        status: "all",
        limit: 10,
      });
      return res.data;
    },
    /**
     * 契約の数を変える。日割りの請求・返金を作らない（research.md R6）。
     * @param subscriptionId - 契約のID
     * @param itemId - 契約の項目のID
     * @param quantity - 新しい数
     * @returns 契約
     */
    updateSubscriptionQuantity(subscriptionId: string, itemId: string, quantity: number) {
      return request<StripeSubscription>("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        items: [{ id: itemId, quantity }],
        proration_behavior: "none",
      });
    },
    /**
     * 契約を今すぐ止める（退会。日割りの返金はしない）。
     * @param subscriptionId - 契約のID
     * @returns 契約
     */
    cancelSubscription(subscriptionId: string) {
      return request<StripeSubscription>("DELETE", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
    },
  };
}

/**
 * 契約の今の期間の終わりを読む（新しい版は契約の項目、古い版は契約に置かれる）。
 * @param s - Stripeの契約
 * @returns 期間の終わり。なければ null
 */
export function periodEndOf(s: StripeSubscription): Date | null {
  const sec = s.items.data[0]?.current_period_end ?? s.current_period_end;
  return sec ? new Date(sec * 1000) : null;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Webhookの署名（Stripe-Signature）を確かめる。t= と v1= を読み、HMAC-SHA256(secret, "t.body") と比べる。
 * @param body - 受け取った本文（そのままの文字列）
 * @param header - Stripe-Signature の値
 * @param secret - STRIPE_WEBHOOK_SECRET
 * @param now - 今の時刻
 * @returns 正しければ true（時刻の差が5分を超えたら false）
 */
export async function verifyWebhookSignature(body: string, header: string | null | undefined, secret: string, now: Date): Promise<boolean> {
  if (!header || !secret) return false;
  let t: string | undefined;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") t = v?.trim();
    else if (k?.trim() === "v1" && v) v1.push(v.trim());
  }
  if (!t || !/^\d+$/.test(t) || v1.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return v1.some((sig) => timingSafeEqual(sig, expected));
}

/**
 * Webhookの署名を作る（テストと偽のStripeが使う）。
 * @param body - 本文
 * @param secret - Webhookの秘密
 * @param at - 署名の時刻
 * @returns Stripe-Signature の値
 */
export async function signWebhook(body: string, secret: string, at: Date): Promise<string> {
  const t = Math.floor(at.getTime() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `t=${t},v1=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))}`;
}

// Stripeからの知らせ（specs/013-billing research.md R5、contracts/api.md）。認証のミドルウェアは通さず、署名で確かめる。
// 知らせの中身は使わず、その顧客の契約をStripeから読み直す（同じ知らせが2回届いても・順番が入れ替わっても結果は同じ）。
// 本文と署名はログに出さない。
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { billingModeOf } from "../lib/config";
import { logger } from "../lib/logger";
import { verifyWebhookSignature } from "../lib/stripe-client";
import { syncCustomer } from "../services/billing-service";

/** 読み直しのきっかけにする知らせの種類。 */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);

/**
 * Stripeの知らせのルート。
 * @returns Hono のルート
 */
export function stripeWebhookRoutes() {
  return new Hono<AppEnv>().post("/stripe/webhook", async (c) => {
    if (!billingModeOf(c.env).enabled) return c.notFound();
    const body = await c.req.text();
    const ok = await verifyWebhookSignature(body, c.req.header("Stripe-Signature"), c.env.STRIPE_WEBHOOK_SECRET ?? "", new Date());
    if (!ok) return c.json({ error: { code: "VALIDATION_FAILED", message: "invalid signature" } }, 400);
    let event: { type?: string; data?: { object?: { customer?: unknown } } };
    try {
      event = JSON.parse(body) as typeof event;
    } catch {
      return c.json({ error: { code: "VALIDATION_FAILED", message: "invalid body" } }, 400);
    }
    const customer = event.data?.object?.customer;
    if (!event.type || !HANDLED.has(event.type) || typeof customer !== "string") return c.json({ received: true });
    const userId = await syncCustomer(c.env, customer);
    // 知らない顧客（退会した人など）は何もしない（FR-056）
    if (!userId) logger.info("billing: webhook for unknown customer ignored", { type: event.type });
    return c.json({ received: true });
  });
}

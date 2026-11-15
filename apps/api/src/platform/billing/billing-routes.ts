// 契約と支払い（specs/013-billing contracts/api.md「契約と支払い」）。どれも自分の契約だけを扱う（Constitution原則IV）。
// 決済がOFFの環境では、GET /api/billing 以外はルートがないのと同じ 404 にする（research.md R11）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { createDb } from "../../kernel/db/client";
import { billingModeOf } from "../../kernel/config";
import { billingSummary, openPortal, startCheckout, syncUser } from "./billing-service";

/**
 * 契約と支払いのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function billingRoutes(authed: MiddlewareHandler<AppEnv>) {
  const enabledOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!billingModeOf(c.env).enabled) return c.notFound();
    await next();
  };
  return new Hono<AppEnv>()
    .get("/billing", authed, async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await billingSummary(createDb(c.env.DATABASE_URL), c.get("user")));
    })
    .post("/billing/checkout", enabledOnly, authed, async (c) => {
      return c.json({ url: await startCheckout(c.env, c.get("user")) });
    })
    .post("/billing/sync", enabledOnly, authed, async (c) => {
      // Checkoutから戻ったとき・画面を開いたときに、知らせを待たずにStripeの今の状態を読み直す（FR-023・FR-036）
      const user = c.get("user");
      await syncUser(c.env, user.id);
      c.header("Cache-Control", "no-store");
      return c.json(await billingSummary(createDb(c.env.DATABASE_URL), user));
    })
    .post("/billing/portal", enabledOnly, authed, async (c) => {
      return c.json({ url: await openPortal(c.env, c.get("user").id) });
    });
}

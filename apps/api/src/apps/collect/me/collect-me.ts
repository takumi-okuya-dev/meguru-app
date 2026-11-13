// /api/collect/me（specs/collect/001-event-day-collection contracts/api.md 1。specs/meguru/029 FR-024 の /api/<アプリ>/me の形）。
// サイドバーの数と、設定への案内に使う。振込待ちの数は、受付の記録の表ができる PR3 まで0。
import type { CollectMe } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import type { AppEnv } from "../../../platform";
import { getSettings } from "../settings/settings-service";

/**
 * 集金管理の「自分」の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function collectMeRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/me", owner, async (c) => {
    const settings = await getSettings(createDb(c.env.DATABASE_URL), c.get("user").id);
    const me: CollectMe = { hasPaypayQr: settings.hasPaypayQr, hasBankText: settings.bankText !== null, awaitingTransferCount: 0 };
    return c.json(me);
  });
}

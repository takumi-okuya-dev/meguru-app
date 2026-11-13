// /api/collect/me（specs/collect/001-event-day-collection contracts/api.md 1。specs/meguru/029 FR-024 の /api/<アプリ>/me の形）。
// サイドバーの数と、設定への案内に使う。振込待ちの数は、主催者のすべてのイベントの振込待ちの記録の数。
import type { CollectMe } from "@meguru/shared";
import { and, count, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import type { AppEnv } from "../../../platform";
import { collectEvents, collectReceptionRecords } from "../schema";
import { getSettings } from "../settings/settings-service";

/**
 * 集金管理の「自分」の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function collectMeRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/me", owner, async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const ownerUserId = c.get("user").id;
    const settings = await getSettings(db, ownerUserId);
    const [awaiting] = await db
      .select({ n: count() })
      .from(collectReceptionRecords)
      .innerJoin(collectEvents, eq(collectEvents.id, collectReceptionRecords.eventId))
      .where(and(eq(collectEvents.ownerUserId, ownerUserId), eq(collectReceptionRecords.paymentStatus, "awaiting_transfer")));
    const me: CollectMe = {
      hasPaypayQr: settings.hasPaypayQr,
      hasBankText: settings.bankText !== null,
      awaitingTransferCount: Number(awaiting?.n ?? 0),
    };
    return c.json(me);
  });
}

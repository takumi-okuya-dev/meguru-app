// 会場の共有の道筋（specs/collect/001-event-day-collection contracts/realtime.md 1、research.md R5、tasks.md T040）。
// - POST /events/:eventId/live-ticket（主催者。手伝う人の入場券は helper-routes.ts）
// - GET /live?ticket=…（WebSocket。ログインなし。入場券の署名と期限を確かめてから、そのイベントの CollectLiveRoom の /connect に渡す）
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import type { AppEnv } from "../../../platform";
import { loadOwnedEvent } from "../access";
import { LIVE_RECEIVER_HEADER } from "./live-room";
import { signLiveTicket, verifyLiveTicket, type LiveReceiver } from "./live-ticket";

/**
 * 入場券の署名の秘密。入れていない間は、会場の共有だけを止める（画面は15秒ごとの読み直しで動く）。
 * @param c - Hono のコンテキスト
 * @returns COLLECT_LIVE_SECRET
 * @throws AppError CONFIG_ERROR（503）
 */
function liveSecret(c: Context<AppEnv>): string {
  const secret = c.env.COLLECT_LIVE_SECRET;
  if (!secret || !c.env.COLLECT_LIVE) throw new AppError("CONFIG_ERROR", 503, "collect live is not configured");
  return secret;
}

/**
 * 入場券を出す。
 * @param c - Hono のコンテキスト
 * @param eventId - イベントの番号（確かめ済み）
 * @param receiver - 受付をする人
 * @returns 応答（入場券と期限）
 */
export async function issueLiveTicket(c: Context<AppEnv>, eventId: string, receiver: LiveReceiver) {
  const { ticket, expiresAt } = await signLiveTicket(liveSecret(c), eventId, receiver, new Date());
  return c.json({ ticket, expiresAt: expiresAt.toISOString() });
}

/**
 * 会場の共有の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function liveRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .post("/events/:eventId/live-ticket", owner, async (c) => {
      const event = await loadOwnedEvent(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"));
      return issueLiveTicket(c, event.id, "owner");
    })
    .get("/live", async (c) => {
      const secret = liveSecret(c);
      const payload = await verifyLiveTicket(secret, c.req.query("ticket") ?? "", new Date());
      if (!payload) throw new AppError("AUTH_REQUIRED", 401, "invalid live ticket");
      if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.text("expected websocket", 426);
      const ns = c.env.COLLECT_LIVE;
      // 利用者の道筋や見出しは渡さない（Durable Object が受けるのは /connect と、確かめた受付をする人だけ）
      return ns.get(ns.idFromName(payload.eventId)).fetch("https://collect-live/connect", {
        headers: { Upgrade: "websocket", [LIVE_RECEIVER_HEADER]: payload.receiver },
      });
    });
}

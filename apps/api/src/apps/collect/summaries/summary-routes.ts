// イベントを消す・まとめの道筋（specs/collect/001-event-day-collection contracts/api.md 2。主催者だけ）。
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import type { AppEnv } from "../../../platform";
import { notifyLive } from "../live/notify";
import { syncCollectUsage } from "../usage/usage";
import { deleteEvent, deleteSummary, listSummaries } from "./summary-service";

/**
 * イベントを消す・まとめの道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function summaryRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .delete("/events/:eventId", owner, async (c) => {
      const eventId = c.req.param("eventId");
      const userId = c.get("user").id;
      const { summaryId, version } = await deleteEvent(c.env.DATABASE_URL, userId, eventId);
      // 受付用リンクも消えたので、手伝う人の画面を止める
      await notifyLive(c, eventId, { type: "link.stopped", version: version + 1 });
      // 「使っているアプリ」から外れることがある（トランザクションのあと。失敗してもイベントは消えたまま）
      await syncCollectUsage(createDb(c.env.DATABASE_URL), userId);
      return c.json({ summaryId });
    })
    .get("/summaries", owner, async (c) => {
      return c.json({ summaries: await listSummaries(createDb(c.env.DATABASE_URL), c.get("user").id) });
    })
    .delete("/summaries/:summaryId", owner, async (c) => {
      await deleteSummary(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("summaryId"));
      return c.json({ ok: true });
    });
}

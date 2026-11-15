// 受付の手伝いの道筋（specs/collect/001-event-day-collection contracts/api.md 5・8、FR-070〜FR-075、tasks.md T050）。
// - 主催者（ログイン・集金管理の利用の許可）：受付用リンクを出す・期限を変える・止める、受付をしている人の一覧
// - 手伝う人（ログインなし）：/r/:token の下だけ。参加のあとは見出し X-Collect-Device が要る。名簿の編集・締め・振込・書き出し・
//   設定・ほかのイベントの道筋は、手伝う人には一切ない（FR-071）
import { COLLECT_DEVICE_HEADER, createReceptionLinkRequestSchema, helperJoinRequestSchema, updateReceptionLinkRequestSchema } from "@meguru/shared";
import { eq } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { issueLiveTicket } from "../live/live-routes";
import { notifyLive } from "../live/notify";
import { handleRecord, handleUndo, handleWalkIn } from "../reception/reception-routes";
import { receptionSnapshot } from "../reception/reception-service";
import { loadQr } from "../settings/settings-service";
import { collectEvents } from "../schema";
import { joinHelper, linkInfo, listWorkers, loadHelperActor } from "./helper-service";
import { createLink, getLink, stopLink, updateLinkExpiry } from "./link-service";

/**
 * 主催者の受付の手伝いの道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function helperOwnerRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/events/:eventId/link", owner, async (c) => {
      return c.json({ link: await getLink(c.env, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")) });
    })
    .post("/events/:eventId/link", owner, async (c) => {
      const { expiresAt } = await parseBody(createReceptionLinkRequestSchema, c.req.json().catch(() => ({})));
      const link = await createLink(c.env, c.get("user").id, c.req.param("eventId"), expiresAt ? new Date(expiresAt) : undefined, new Date());
      return c.json({ link });
    })
    .patch("/events/:eventId/link", owner, async (c) => {
      const { expiresAt } = await parseBody(updateReceptionLinkRequestSchema, c.req.json());
      return c.json({ link: await updateLinkExpiry(c.env, c.get("user").id, c.req.param("eventId"), new Date(expiresAt), new Date()) });
    })
    .post("/events/:eventId/link/stop", owner, async (c) => {
      const eventId = c.req.param("eventId");
      const { version } = await stopLink(c.env.DATABASE_URL, c.get("user").id, eventId, new Date());
      await notifyLive(c, eventId, { type: "link.stopped", version });
      return c.json({ link: null });
    })
    .get("/events/:eventId/helpers", owner, async (c) => {
      return c.json(await listWorkers(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")));
    });
}

/**
 * 手伝う人を確かめる（リンク → 端末の印）。
 * @param c - Hono のコンテキスト
 * @returns 受付をする人（手伝う人）
 */
const helperActor = (c: Context<AppEnv>) =>
  loadHelperActor(createDb(c.env.DATABASE_URL), c.req.param("token") ?? "", c.req.header(COLLECT_DEVICE_HEADER), new Date());

/**
 * 手伝う人の道筋を作る（ログインの関所の外。/api/collect/r/:token/…）。
 * @returns Hono のアプリ
 */
export function helperPublicRoutes() {
  return new Hono<AppEnv>()
    .get("/r/:token", async (c) => {
      return c.json(await linkInfo(createDb(c.env.DATABASE_URL), c.req.param("token"), new Date()));
    })
    .post("/r/:token/join", async (c) => {
      const input = await parseBody(helperJoinRequestSchema, c.req.json());
      const joined = await joinHelper(c.env.DATABASE_URL, c.req.param("token"), input, new Date());
      await notifyLive(c, joined.eventId, { type: "helpers.changed", version: joined.version, helpers: joined.helpers });
      return c.json({ helperId: joined.helperId, deviceSecret: joined.deviceSecret }, 201);
    })
    .get("/r/:token/reception", async (c) => {
      const actor = await helperActor(c);
      return c.json(await receptionSnapshot(createDb(c.env.DATABASE_URL), actor, actor.eventId));
    })
    .put("/r/:token/reception/:personId", async (c) => {
      const actor = await helperActor(c);
      return handleRecord(c, actor, actor.eventId);
    })
    .delete("/r/:token/reception/:personId", async (c) => {
      const actor = await helperActor(c);
      return handleUndo(c, actor, actor.eventId);
    })
    .post("/r/:token/walk-ins", async (c) => {
      const actor = await helperActor(c);
      return handleWalkIn(c, actor, actor.eventId);
    })
    .get("/r/:token/paypay-qr", async (c) => {
      const actor = await helperActor(c);
      const db = createDb(c.env.DATABASE_URL);
      const [event] = await db.select({ ownerUserId: collectEvents.ownerUserId }).from(collectEvents).where(eq(collectEvents.id, actor.eventId)).limit(1);
      const qr = event ? await loadQr(db, event.ownerUserId) : null;
      if (!qr) throw new AppError("ITEM_NOT_FOUND", 404, "no paypay qr");
      return c.body(new Uint8Array(qr.bytes), 200, { "Content-Type": qr.type, "Cache-Control": "private, no-store" });
    })
    .post("/r/:token/live-ticket", async (c) => {
      const actor = await helperActor(c);
      return issueLiveTicket(c, actor.eventId, `helper:${actor.helperId}`);
    });
}

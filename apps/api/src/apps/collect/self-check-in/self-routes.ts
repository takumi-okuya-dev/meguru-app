// セルフ受付の道筋（specs/collect/002-self-check-in contracts/api.md）。
// - 参加者（ログインなし。/s/:token/…。端末の印は見出し X-Collect-Device）
// - 受付をする人（主催者 /events/:eventId/…・手伝う人 /r/:token/…）：確かめる・申し出を片付ける
// - 主催者：セルフ受付のリンク（/events/:eventId/self-link）
import {
  COLLECT_DEVICE_HEADER,
  COLLECT_SELF_DEVICE_HEADER,
  confirmReceptionRequestSchema,
  createReceptionLinkRequestSchema,
  matchSelfRequestSchema,
  selfDeclareRequestSchema,
  selfRequestCreateSchema,
  selfSearchRequestSchema,
  updateReceptionLinkRequestSchema,
} from "@meguru/shared";
import { eq } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import type { ReceptionActor } from "../access";
import { loadHelperActor } from "../helpers/helper-service";
import { createLink, getLink, stopLink, updateLinkExpiry } from "../helpers/link-service";
import { notifyLive } from "../live/notify";
import { ownerActor } from "../reception/reception-routes";
import { confirmReception } from "../reception/reception-service";
import { collectEvents } from "../schema";
import { loadQr } from "../settings/settings-service";
import { acceptRequest, createRequest, matchRequest, rejectRequest } from "./request-service";
import { activeSelfLink, declareSelf, deviceHashOf, loadSelfLink, searchSelf, selfLinkInfo, selfMe } from "./self-service";

/**
 * 確かめる（POST …/reception/:personId/confirm）。
 * @param c - Hono のコンテキスト
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @returns 応答（記録と新しい版）
 */
async function handleConfirm(c: Context<AppEnv>, actor: ReceptionActor, eventId: string) {
  const input = await parseBody(confirmReceptionRequestSchema, c.req.json().catch(() => ({})));
  const personId = c.req.param("personId") ?? "";
  const { record, version } = await confirmReception(c.env.DATABASE_URL, actor, eventId, personId, input);
  await notifyLive(c, eventId, { type: "reception.recorded", version, personId, record });
  return c.json({ record, version });
}

/**
 * 申し出を片付ける（accept・match・reject）。
 * @param c - Hono のコンテキスト
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @param action - 片付け方
 * @returns 応答（新しい版。名簿に入れたら人）
 */
async function handleResolve(c: Context<AppEnv>, actor: ReceptionActor, eventId: string, action: "accept" | "match" | "reject") {
  const requestId = c.req.param("requestId") ?? "";
  const db = c.env.DATABASE_URL;
  const result =
    action === "accept"
      ? await acceptRequest(db, actor, eventId, requestId)
      : action === "match"
        ? await matchRequest(db, actor, eventId, requestId, (await parseBody(matchSelfRequestSchema, c.req.json())).personId)
        : await rejectRequest(db, actor, eventId, requestId);
  // 名簿に入れたときは、名簿の人と申し出の一覧を1つの知らせで送る（同じ版）
  if (result.person) {
    await notifyLive(c, eventId, { type: "roster.changed", version: result.version, personId: result.person.id, person: result.person, selfRequests: result.requests });
  } else await notifyLive(c, eventId, { type: "self_requests.changed", version: result.version, selfRequests: result.requests });
  return c.json({ version: result.version, ...(result.person ? { person: result.person } : {}) });
}

/**
 * 手伝う人を確かめる（リンク → 端末の印）。
 * @param c - Hono のコンテキスト
 * @returns 受付をする人（手伝う人）
 */
const helperActor = (c: Context<AppEnv>) =>
  loadHelperActor(createDb(c.env.DATABASE_URL), c.req.param("token") ?? "", c.req.header(COLLECT_DEVICE_HEADER), new Date());

/**
 * 受付をする人と主催者のセルフ受付の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function selfStaffRoutes(owner: MiddlewareHandler<AppEnv>) {
  return (
    new Hono<AppEnv>()
      // ---- セルフ受付のリンク（主催者だけ。spec FR-001・FR-003） ----
      .get("/events/:eventId/self-link", owner, async (c) => {
        return c.json({ link: await getLink(c.env, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), "self") });
      })
      .post("/events/:eventId/self-link", owner, async (c) => {
        const { expiresAt } = await parseBody(createReceptionLinkRequestSchema, c.req.json().catch(() => ({})));
        const link = await createLink(c.env, c.get("user").id, c.req.param("eventId"), expiresAt ? new Date(expiresAt) : undefined, new Date(), "self");
        return c.json({ link });
      })
      .patch("/events/:eventId/self-link", owner, async (c) => {
        const { expiresAt } = await parseBody(updateReceptionLinkRequestSchema, c.req.json());
        return c.json({ link: await updateLinkExpiry(c.env, c.get("user").id, c.req.param("eventId"), new Date(expiresAt), new Date(), "self") });
      })
      .post("/events/:eventId/self-link/stop", owner, async (c) => {
        const eventId = c.req.param("eventId");
        const { version } = await stopLink(c.env.DATABASE_URL, c.get("user").id, eventId, new Date(), "self");
        await notifyLive(c, eventId, { type: "self_link.stopped", version });
        return c.json({ link: null });
      })
      // ---- 確かめる・申し出（主催者） ----
      .post("/events/:eventId/reception/:personId/confirm", owner, (c) => handleConfirm(c, ownerActor(c), c.req.param("eventId")))
      .post("/events/:eventId/self-requests/:requestId/accept", owner, (c) => handleResolve(c, ownerActor(c), c.req.param("eventId"), "accept"))
      .post("/events/:eventId/self-requests/:requestId/match", owner, (c) => handleResolve(c, ownerActor(c), c.req.param("eventId"), "match"))
      .post("/events/:eventId/self-requests/:requestId/reject", owner, (c) => handleResolve(c, ownerActor(c), c.req.param("eventId"), "reject"))
      // ---- 確かめる・申し出（手伝う人。ログインの関所の外） ----
      .post("/r/:token/reception/:personId/confirm", async (c) => {
        const actor = await helperActor(c);
        return handleConfirm(c, actor, actor.eventId);
      })
      .post("/r/:token/self-requests/:requestId/accept", async (c) => {
        const actor = await helperActor(c);
        return handleResolve(c, actor, actor.eventId, "accept");
      })
      .post("/r/:token/self-requests/:requestId/match", async (c) => {
        const actor = await helperActor(c);
        return handleResolve(c, actor, actor.eventId, "match");
      })
      .post("/r/:token/self-requests/:requestId/reject", async (c) => {
        const actor = await helperActor(c);
        return handleResolve(c, actor, actor.eventId, "reject");
      })
  );
}

/**
 * 参加者の道筋を作る（ログインの関所の外。/api/collect/s/:token/…）。
 * @returns Hono のアプリ
 */
export function selfPublicRoutes() {
  const device = (c: Context<AppEnv>) => deviceHashOf(c.req.header(COLLECT_SELF_DEVICE_HEADER));
  return new Hono<AppEnv>()
    .get("/s/:token", async (c) => {
      return c.json(await selfLinkInfo(createDb(c.env.DATABASE_URL), c.req.param("token"), new Date()));
    })
    .post("/s/:token/search", async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const now = new Date();
      const link = await activeSelfLink(db, c.req.param("token"), now);
      const { query } = await parseBody(selfSearchRequestSchema, c.req.json());
      return c.json(await searchSelf(db, link, await device(c), query, now));
    })
    .post("/s/:token/declare", async (c) => {
      const link = await activeSelfLink(createDb(c.env.DATABASE_URL), c.req.param("token"), new Date());
      const input = await parseBody(selfDeclareRequestSchema, c.req.json());
      const { record, version, replayed, changed } = await declareSelf(c.env.DATABASE_URL, link, await device(c), input);
      if (!replayed) await notifyLive(c, link.eventId, { type: "reception.recorded", version, personId: record.personId, record });
      return c.json({ record: { method: record.method, paymentStatus: record.paymentStatus, amount: record.amount } }, changed ? 200 : 201);
    })
    .post("/s/:token/requests", async (c) => {
      const link = await activeSelfLink(createDb(c.env.DATABASE_URL), c.req.param("token"), new Date());
      const input = await parseBody(selfRequestCreateSchema, c.req.json());
      const { requestId, version, requests } = await createRequest(c.env.DATABASE_URL, link, await device(c), input);
      await notifyLive(c, link.eventId, { type: "self_requests.changed", version, selfRequests: requests });
      return c.json({ requestId }, 201);
    })
    .get("/s/:token/me", async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const link = await loadSelfLink(db, c.req.param("token"));
      c.header("Cache-Control", "no-store");
      return c.json(await selfMe(db, link, await device(c), new Date()));
    })
    .get("/s/:token/paypay-qr", async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const link = await activeSelfLink(db, c.req.param("token"), new Date());
      const [event] = await db.select({ ownerUserId: collectEvents.ownerUserId }).from(collectEvents).where(eq(collectEvents.id, link.eventId)).limit(1);
      const qr = event ? await loadQr(db, event.ownerUserId) : null;
      if (!qr) throw new AppError("ITEM_NOT_FOUND", 404, "no paypay qr");
      return c.body(new Uint8Array(qr.bytes), 200, { "Content-Type": qr.type, "Cache-Control": "private, no-store" });
    });
}

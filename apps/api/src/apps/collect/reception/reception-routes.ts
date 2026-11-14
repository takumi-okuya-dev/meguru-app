// 受付の道筋（specs/collect/001-event-day-collection contracts/api.md 4。主催者）と、主催者・手伝う人で同じ処理（記録・取り消し・飛び入り）。
// 保存が終わってから、会場の共有に知らせる（contracts/realtime.md 2）。送り直し（replayed）は知らせない。
import { recordReceptionRequestSchema, walkInRequestSchema } from "@meguru/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import type { ReceptionActor } from "../access";
import { notifyLive } from "../live/notify";
import { addWalkIn, receptionSnapshot, recordReception, undoReception } from "./reception-service";

/**
 * 主催者の受付をする人。
 * @param c - Hono のコンテキスト（ログイン済み）
 * @returns 受付をする人
 */
export const ownerActor = (c: Context<AppEnv>): ReceptionActor => ({ kind: "owner", ownerUserId: c.get("user").id });

/**
 * 受付を記録する（PUT …/reception/:personId）。
 * @param c - Hono のコンテキスト
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @returns 応答（201・記録と新しい版）
 */
export async function handleRecord(c: Context<AppEnv>, actor: ReceptionActor, eventId: string) {
  const input = await parseBody(recordReceptionRequestSchema, c.req.json());
  const personId = c.req.param("personId") ?? "";
  const { record, version, replayed } = await recordReception(c.env.DATABASE_URL, actor, eventId, personId, input);
  if (!replayed) await notifyLive(c, eventId, { type: "reception.recorded", version, personId, record });
  return c.json({ record, version }, 201);
}

/**
 * 受付を取り消す（DELETE …/reception/:personId）。
 * @param c - Hono のコンテキスト
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @returns 応答（新しい版）
 */
export async function handleUndo(c: Context<AppEnv>, actor: ReceptionActor, eventId: string) {
  const personId = c.req.param("personId") ?? "";
  const { version } = await undoReception(c.env.DATABASE_URL, actor, eventId, personId);
  await notifyLive(c, eventId, { type: "reception.undone", version, personId });
  return c.json({ version });
}

/**
 * 飛び入りを足す（POST …/walk-ins）。
 * @param c - Hono のコンテキスト
 * @param actor - 受付をする人
 * @param eventId - イベントの番号
 * @returns 応答（201・足した人と新しい版）
 */
export async function handleWalkIn(c: Context<AppEnv>, actor: ReceptionActor, eventId: string) {
  const input = await parseBody(walkInRequestSchema, c.req.json());
  const { person, version, replayed } = await addWalkIn(c.env.DATABASE_URL, actor, eventId, input);
  if (!replayed) await notifyLive(c, eventId, { type: "roster.changed", version, personId: person.id, person });
  return c.json({ person, version }, 201);
}

/**
 * 主催者の受付の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function receptionRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/events/:eventId/reception", owner, async (c) => {
      return c.json(await receptionSnapshot(createDb(c.env.DATABASE_URL), ownerActor(c), c.req.param("eventId")));
    })
    .put("/events/:eventId/reception/:personId", owner, (c) => handleRecord(c, ownerActor(c), c.req.param("eventId")))
    .delete("/events/:eventId/reception/:personId", owner, (c) => handleUndo(c, ownerActor(c), c.req.param("eventId")))
    .post("/events/:eventId/walk-ins", owner, (c) => handleWalkIn(c, ownerActor(c), c.req.param("eventId")));
}

// 会場の共有への知らせ（specs/collect/001-event-day-collection research.md R4、contracts/realtime.md 2、tasks.md T040）。
// 保存が終わってから、そのイベントの CollectLiveRoom に送る。応答は待たせない（waitUntil）。送れなくても保存は取り消さない
// （画面は version の飛び・つなぎ直し・15秒ごとの読み直しで追いつく）。
import type { LiveMessage } from "@meguru/shared";
import type { Context } from "hono";
import { logger } from "../../../kernel/logger";
import type { AppEnv } from "../../../platform";

/** 知らせの中身（eventId と at はここで足す）。 */
export type LiveMessageBody = LiveMessage extends infer M ? (M extends unknown ? Omit<M, "eventId" | "at"> : never) : never;

/**
 * 応答を返した後も続けたい処理を、Workers の waitUntil に渡す。ExecutionContext がない（テストの app.request）ときは待つ。
 * @param c - Hono のコンテキスト
 * @param p - 続けたい処理
 */
async function afterResponse(c: Context<AppEnv>, p: Promise<void>): Promise<void> {
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx as ExecutionContext;
  } catch {
    ctx = undefined;
  }
  if (ctx) ctx.waitUntil(p);
  else await p;
}

/**
 * イベントの会場の共有に知らせる。
 * @param c - Hono のコンテキスト
 * @param eventId - イベントの番号
 * @param message - 知らせ（type・version と中身）
 */
export async function notifyLive(c: Context<AppEnv>, eventId: string, message: LiveMessageBody): Promise<void> {
  const ns = c.env.COLLECT_LIVE;
  if (!ns) return;
  const body = JSON.stringify({ ...message, eventId, at: new Date().toISOString() });
  const send = ns
    .get(ns.idFromName(eventId))
    .fetch("https://collect-live/broadcast", { method: "POST", body })
    .then((res) => {
      if (!res.ok) logger.warn("collect live: broadcast failed", { status: res.status, type: message.type });
    })
    .catch((err: unknown) => logger.warn("collect live: broadcast failed", { err, type: message.type }));
  await afterResponse(c, send);
}

// 集金管理の確かめと権限（specs/collect/001-event-day-collection contracts/api.md 0、tasks.md T015）。
// 主催者の道筋の関所と、イベントがその主催者のものかの確かめを、ここに集める（Constitution原則V）。手伝う人の確かめは PR2 で足す。
import { COLLECT_APP } from "@meguru/shared";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import type { Db, TxDb } from "../../kernel/db/client";
import { AppError } from "../../kernel/errors";
import { isUuid } from "../../kernel/validate";
import { allowBeforeSubscribe, requireAppAccess, type AppEnv } from "../../platform";
import { collectEvents } from "./schema";

/** イベントの行。 */
export type CollectEventRow = typeof collectEvents.$inferSelect;

/**
 * 主催者の道筋の関所：ログイン → 集金管理の利用の許可（なければ 403 APP_NOT_AVAILABLE）。
 * 001 の集金管理は料金なしなので、Threadsの契約の前でも呼べる印（allowBeforeSubscribe）を、ログインより前に付ける。
 * @param authed - ログインのミドルウェア
 * @returns Hono のミドルウェア
 */
export function collectOwner(authed: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> {
  return every(allowBeforeSubscribe, authed, requireAppAccess(COLLECT_APP));
}

/**
 * ない・ほかの主催者のイベント（あるかどうかを見せない）。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
export const eventNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "event not found");

/**
 * 主催者のイベントを読む。ない・ほかの主催者のものなら 404（あるかどうかを見せない）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param ownerUserId - 主催者（呼んだ人）
 * @param eventId - イベントの番号（道筋の値）
 * @param opts - forUpdate：行をロックする（トランザクションの中で、番号や版を上げる前に）
 * @returns イベントの行
 * @throws AppError ITEM_NOT_FOUND
 */
export async function loadOwnedEvent(
  db: Db | TxDb,
  ownerUserId: string,
  eventId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<CollectEventRow> {
  if (!isUuid(eventId)) throw eventNotFound();
  const q = db
    .select()
    .from(collectEvents)
    .where(and(eq(collectEvents.id, eventId), eq(collectEvents.ownerUserId, ownerUserId)))
    .limit(1);
  const [row] = await (opts.forUpdate ? q.for("update") : q);
  if (!row) throw eventNotFound();
  return row;
}

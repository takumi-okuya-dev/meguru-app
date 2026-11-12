// 出来事（specs/meguru/029-threads-pattern1 research.md R5、contracts/platform-entry.md 3）。
// 共通で起きたことを、表の変更と同じトランザクションで送り出しの表に書き、あとでアプリの受け取りに届ける。
// 届けるのは、書いた直後（応答のあと）と5分ごとの定期処理。失敗したら間をあけてやり直し、10回で止める。
// 受け取りは、同じ出来事が2回届いても結果が変わらないように作る（アプリの側で番号を記録する）。
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { createDb, type Db, type TxDb } from "../../kernel/db/client";
import type { Env } from "../../kernel/env";
import { logger } from "../../kernel/logger";
import { platformEventDeliveries, platformEvents } from "../schema";

/** 出来事の種類と中身。中身に入れるのは番号だけ（メールアドレス・名前・本文は入れない）。 */
export type PlatformEventPayloads = {
  /** 利用者が退会した */
  "user.withdrawn": { userId: string };
  /** 運営者が上限を変えた（userId がなければ既定の値の変更） */
  "limits.changed": { app: string; userId?: string };
};

/** 出来事の種類。 */
export type PlatformEventType = keyof PlatformEventPayloads;

/** 受け取りに渡す出来事。 */
export type PlatformEvent<K extends PlatformEventType = PlatformEventType> = {
  id: string;
  type: K;
  payload: PlatformEventPayloads[K];
  createdAt: Date;
};

/** 出来事の受け取り。例外を投げたら失敗（やり直す）。 */
export type EventConsumer<K extends PlatformEventType = PlatformEventType> = (
  db: Db,
  event: PlatformEvent<K>,
  env: Env,
) => Promise<void>;

/** 何度失敗したら止めるか。 */
export const MAX_DELIVERY_ATTEMPTS = 10;
/** 1回の処理で届ける上限（5分ごとの定期処理の持ち時間に収める）。 */
const DELIVERY_BATCH = 50;

const consumers = new Map<string, Map<PlatformEventType, EventConsumer>>();

/**
 * 出来事の受け取りを登録する（組み立てから）。同じ届け先・同じ種類は1回だけ（2回目からは何もしない）。
 * @param consumer - 届け先（アプリの番号）
 * @param type - 出来事の種類
 * @param handler - 受け取り
 */
export function registerConsumer<K extends PlatformEventType>(consumer: string, type: K, handler: EventConsumer<K>): void {
  const byType = consumers.get(consumer) ?? new Map<PlatformEventType, EventConsumer>();
  consumers.set(consumer, byType);
  if (!byType.has(type)) byType.set(type, handler as unknown as EventConsumer);
}

/**
 * その種類の出来事の届け先（登録した順）。
 * @param type - 出来事の種類
 * @returns 届け先
 */
export function consumersOf(type: PlatformEventType): string[] {
  return [...consumers.entries()].filter(([, byType]) => byType.has(type)).map(([name]) => name);
}

/** 登録をすべて消す（テスト用）。 */
export function resetConsumers(): void {
  consumers.clear();
}

/**
 * 出来事を書く。共通の表の変更と同じトランザクションで呼ぶ（戻れば出来事も残らない）。
 * 届け先が1つも登録されていなければ例外にする（組み立てが登録を忘れたまま、アプリの片づけを黙って飛ばさないため）。
 * @param tx - 共通のトランザクション
 * @param type - 種類
 * @param payload - 中身
 * @returns 出来事の番号
 * @throws Error 届け先が登録されていないとき
 */
export async function emitEvent<K extends PlatformEventType>(
  tx: Db | TxDb,
  type: K,
  payload: PlatformEventPayloads[K],
): Promise<string> {
  const targets = consumersOf(type);
  if (targets.length === 0) throw new Error(`出来事「${type}」の受け取りが登録されていません（組み立てで registerConsumer を呼んでください）`);
  const id = crypto.randomUUID();
  await tx.insert(platformEvents).values({ id, type, payload });
  await tx.insert(platformEventDeliveries).values(targets.map((consumer) => ({ eventId: id, consumer })));
  return id;
}

/**
 * やり直すまでの間（5分・10分・20分・40分・以降60分）。
 * @param attempts - 試した回数（失敗のあと）
 * @returns 間（ミリ秒）
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(5 * 2 ** Math.max(attempts - 1, 0), 60) * 60_000;
}

/**
 * 失敗の要約（秘密の値や本文を残さないよう、メッセージの先頭だけ）。
 * @param err - 捕まえたエラー
 * @returns 要約
 */
function errorSummary(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return message.slice(0, 200);
}

/**
 * 時刻の来た出来事を、届け先ごとに古い順に届ける。届け先ごとに「借りる」（次に試す時刻を先へ進める）ので、
 * 書いた直後の届けと定期処理が重なっても、同じ届け先に同時に2回は届けない。
 * @param env - Workers のバインディング
 * @param now - 今の時刻
 * @returns 届けた数と失敗した数
 */
export async function deliverPendingEvents(env: Env, now: Date = new Date()): Promise<{ delivered: number; failed: number }> {
  const db = createDb(env.DATABASE_URL);
  const due = await db
    .select({
      eventId: platformEventDeliveries.eventId,
      consumer: platformEventDeliveries.consumer,
      attempts: platformEventDeliveries.attempts,
      type: platformEvents.type,
      payload: platformEvents.payload,
      createdAt: platformEvents.createdAt,
    })
    .from(platformEventDeliveries)
    .innerJoin(platformEvents, eq(platformEvents.id, platformEventDeliveries.eventId))
    .where(and(eq(platformEventDeliveries.status, "pending"), lte(platformEventDeliveries.nextAttemptAt, now)))
    .orderBy(asc(platformEvents.createdAt))
    .limit(DELIVERY_BATCH);
  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    const where = and(eq(platformEventDeliveries.eventId, d.eventId), eq(platformEventDeliveries.consumer, d.consumer));
    // 借りる：まだ pending で時刻が来ているときだけ、次に試す時刻を先へ（ほかの処理に取られていたら飛ばす）
    const lease = new Date(now.getTime() + retryDelayMs(d.attempts + 1));
    const [claimed] = await db
      .update(platformEventDeliveries)
      .set({ nextAttemptAt: lease })
      .where(and(where, eq(platformEventDeliveries.status, "pending"), lte(platformEventDeliveries.nextAttemptAt, now)))
      .returning({ attempts: platformEventDeliveries.attempts });
    if (!claimed) continue;
    const handler = consumers.get(d.consumer)?.get(d.type as PlatformEventType);
    const attempts = claimed.attempts + 1;
    try {
      if (!handler) throw new Error(`受け取りが登録されていません（${d.consumer} / ${d.type}）`);
      await handler(db, { id: d.eventId, type: d.type as PlatformEventType, payload: d.payload as never, createdAt: d.createdAt }, env);
      await db.update(platformEventDeliveries).set({ status: "done", attempts, deliveredAt: now, lastError: null }).where(where);
      delivered += 1;
    } catch (err) {
      const stop = attempts >= MAX_DELIVERY_ATTEMPTS;
      await db
        .update(platformEventDeliveries)
        .set({
          status: stop ? "failed" : "pending",
          attempts,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
          lastError: errorSummary(err),
        })
        .where(where);
      const fields = { eventId: d.eventId, consumer: d.consumer, type: d.type, attempts, err: errorSummary(err) };
      if (stop) logger.error("platform event: delivery failed", fields);
      else logger.warn("platform event: delivery will retry", fields);
      failed += 1;
    }
  }
  return { delivered, failed };
}

/**
 * 届け先がすべて済んで30日たった出来事を消す（毎日のまとめ処理）。
 * @param db - データベース
 * @param now - 今の時刻
 * @returns 消した数
 */
export async function purgeDeliveredEvents(db: Db, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await db
    .delete(platformEvents)
    .where(
      and(
        lte(platformEvents.createdAt, before),
        sql`NOT EXISTS (SELECT 1 FROM ${platformEventDeliveries} WHERE ${platformEventDeliveries.eventId} = ${platformEvents.id} AND ${platformEventDeliveries.status} <> 'done')`,
      ),
    )
    .returning({ id: platformEvents.id });
  return rows.length;
}

/**
 * 出来事の届け先ごとの状態を読む（テストと運営者の調べ用）。
 * @param db - データベース
 * @param eventIds - 出来事の番号
 * @returns 状態
 */
export async function deliveriesOf(db: Db, eventIds: string[]) {
  if (eventIds.length === 0) return [];
  return db.select().from(platformEventDeliveries).where(inArray(platformEventDeliveries.eventId, eventIds));
}

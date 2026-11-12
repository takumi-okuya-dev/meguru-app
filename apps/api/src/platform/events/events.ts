// 出来事（specs/meguru/029-threads-pattern1 research.md R5、contracts/platform-entry.md 3）。
// 共通で起きたことを、表の変更と同じトランザクションで送り出しの表に書き、あとでアプリの受け取りに届ける。
// 届けるのは、書いた直後（応答のあと）と5分ごとの定期処理。失敗したら間をあけてやり直し、10回で止める。
// 受け取りは、同じ出来事が2回届いても結果が変わらないように作る（アプリの側で番号を記録する）。
import { and, asc, eq, gte, inArray, lt, lte, min, sql } from "drizzle-orm";
import { createDb, type Db, type TxDb } from "../../kernel/db/client";
import type { Env } from "../../kernel/env";
import { logger } from "../../kernel/logger";
import { wakeEventDelivery } from "./delivery-gate";
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

/**
 * 出来事の受け取り。例外を投げたら失敗（やり直す）。自分の表を直すときは、自分でトランザクションを開く
 * （`withTransaction(env.DATABASE_URL, …)`。受け取った番号の記録と表の変更を、同じトランザクションで行う）。
 */
export type EventConsumer<K extends PlatformEventType = PlatformEventType> = (event: PlatformEvent<K>, env: Env) => Promise<void>;

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
  // 時刻は、届ける側（deliverPendingEvents）と同じ Workers の時計で入れる。DBの now() は Workers の時計と少しずれることがあり、
  // 書いた直後に届けようとしても「まだ時刻が来ていない」になるため
  const at = new Date();
  await tx.insert(platformEvents).values({ id, type, payload, createdAt: at });
  await tx.insert(platformEventDeliveries).values(targets.map((consumer) => ({ eventId: id, consumer, nextAttemptAt: at })));
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
 * 出来事を書いたら、トランザクションのあとで必ず eventIds つきで呼ぶ（書いた直後の届け）。届け残しがあれば、5分ごとの届けを起こす
 * （5分ごとの届けは、用がなければKVの関所で眠っているため。delivery-gate.ts）。
 * @param env - Workers のバインディング
 * @param now - 今の時刻
 * @param opts - eventIds：この出来事だけを届ける（書いた直後に、ほかの出来事まで待たずに届けるため。PR #96 のセルフレビュー）
 * @returns 届けた数と失敗した数
 */
export async function deliverPendingEvents(
  env: Env,
  now: Date = new Date(),
  opts: { eventIds?: readonly string[] } = {},
): Promise<{ delivered: number; failed: number }> {
  if (opts.eventIds && opts.eventIds.length === 0) return { delivered: 0, failed: 0 };
  if (!opts.eventIds) return (await deliverDue(env, now)).result;
  // 書いた直後の届け：届け残し（失敗・ほかの処理が借りている）か、途中の失敗があれば、5分ごとの届けを起こす。
  // 知らせはトランザクションのあとに書くので、知らせより前に始まった5分ごとの回がDBを見落としても、次の回が必ずDBを見る
  try {
    const { result, leftover } = await deliverDue(env, now, opts.eventIds);
    if (leftover) await wakeEventDelivery(env.AUTOPOST_KV);
    return result;
  } catch (err) {
    await wakeEventDelivery(env.AUTOPOST_KV);
    throw err;
  }
}

/**
 * 時刻の来た届けを、受け取りに渡す（deliverPendingEvents の中身）。
 * @param env - Workers のバインディング
 * @param now - 今の時刻
 * @param eventIds - この出来事だけを届ける（省けば、時刻の来たものすべて）
 * @returns 届けた数と失敗した数、届け残しがあるか
 */
async function deliverDue(
  env: Env,
  now: Date,
  eventIds?: readonly string[],
): Promise<{ result: { delivered: number; failed: number }; leftover: boolean }> {
  const only = eventIds ? inArray(platformEventDeliveries.eventId, [...eventIds]) : undefined;
  const db = createDb(env.DATABASE_URL);
  // 試した回数が上限に達したまま pending の行（受け取りの途中で止まり続けた）は、受け取りを呼ばずに failed にする（PR #92 のCodexレビュー）
  const exhausted = await db
    .update(platformEventDeliveries)
    .set({ status: "failed", lastError: sql`coalesce(${platformEventDeliveries.lastError}, '受け取りの途中で止まった')` })
    .where(
      and(
        eq(platformEventDeliveries.status, "pending"),
        gte(platformEventDeliveries.attempts, MAX_DELIVERY_ATTEMPTS),
        lte(platformEventDeliveries.nextAttemptAt, now),
        only,
      ),
    )
    .returning({ eventId: platformEventDeliveries.eventId, consumer: platformEventDeliveries.consumer });
  for (const e of exhausted) logger.error("platform event: delivery failed", { ...e, attempts: MAX_DELIVERY_ATTEMPTS, err: "interrupted" });
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
    .where(and(eq(platformEventDeliveries.status, "pending"), lte(platformEventDeliveries.nextAttemptAt, now), only))
    .orderBy(asc(platformEvents.createdAt))
    .limit(DELIVERY_BATCH);
  let delivered = 0;
  let leftover = false;
  let failed = exhausted.length;
  for (const d of due) {
    const where = and(eq(platformEventDeliveries.eventId, d.eventId), eq(platformEventDeliveries.consumer, d.consumer));
    // 借りる：まだ pending で時刻が来ているときだけ、次に試す時刻を先へ進め、試した回数を増やす（ほかの処理に取られていたら飛ばす）。
    // 回数を先に増やすので、受け取りの途中で Worker が止まっても、その回は数えられ、いつかは failed で止まる
    const lease = new Date(now.getTime() + retryDelayMs(d.attempts + 1));
    const [claimed] = await db
      .update(platformEventDeliveries)
      .set({ nextAttemptAt: lease, attempts: sql`${platformEventDeliveries.attempts} + 1` })
      .where(
        and(
          where,
          eq(platformEventDeliveries.status, "pending"),
          lte(platformEventDeliveries.nextAttemptAt, now),
          lt(platformEventDeliveries.attempts, MAX_DELIVERY_ATTEMPTS),
        ),
      )
      .returning({ attempts: platformEventDeliveries.attempts });
    if (!claimed) {
      leftover = true;
      continue;
    }
    const handler = consumers.get(d.consumer)?.get(d.type as PlatformEventType);
    const attempts = claimed.attempts;
    try {
      if (!handler) throw new Error(`受け取りが登録されていません（${d.consumer} / ${d.type}）`);
      await handler({ id: d.eventId, type: d.type as PlatformEventType, payload: d.payload as never, createdAt: d.createdAt }, env);
      await db.update(platformEventDeliveries).set({ status: "done", deliveredAt: now, lastError: null }).where(where);
      delivered += 1;
    } catch (err) {
      const stop = attempts >= MAX_DELIVERY_ATTEMPTS;
      await db
        .update(platformEventDeliveries)
        .set({
          status: stop ? "failed" : "pending",
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
  return { result: { delivered, failed }, leftover: leftover || failed > 0 };
}

/**
 * まだ届いていない届けのうち、いちばん早い「次に試す時刻」（5分ごとの届けの関所が、次に見る時刻に使う）。
 * @param db - データベース
 * @returns 時刻（届いていない届けがなければ null）
 */
export async function nextPendingAttemptAt(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ at: min(platformEventDeliveries.nextAttemptAt) })
    .from(platformEventDeliveries)
    .where(eq(platformEventDeliveries.status, "pending"));
  return row?.at ? new Date(row.at) : null;
}

/**
 * 失敗で止まった届けを、もう一度届ける状態に戻す（試した回数も0に戻す）。退会の続きのように、届かないと先へ進めない
 * 処理が、日次でやり直すときに使う。
 * @param db - データベース
 * @param eventIds - 出来事の番号
 * @param now - 今の時刻
 * @returns 戻した数
 */
export async function rearmFailedDeliveries(db: Db, eventIds: readonly string[], now: Date = new Date()): Promise<number> {
  if (eventIds.length === 0) return 0;
  const rows = await db
    .update(platformEventDeliveries)
    .set({ status: "pending", attempts: 0, nextAttemptAt: now })
    .where(and(inArray(platformEventDeliveries.eventId, [...eventIds]), eq(platformEventDeliveries.status, "failed")))
    .returning({ eventId: platformEventDeliveries.eventId });
  return rows.length;
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

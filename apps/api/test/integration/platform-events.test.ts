// 出来事（specs/meguru/029-threads-pattern1 research.md R5、contracts/platform-entry.md 3・6、T003）。
// 同じトランザクションで書く・届け先ごとに pending の行ができる・届くと done・失敗したら間をあけてやり直す・10回で failed。
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../src/kernel/db/client";
import {
  MAX_DELIVERY_ATTEMPTS,
  deliverPendingEvents,
  deliveriesOf,
  emitEvent,
  purgeDeliveredEvents,
  registerConsumer,
  resetConsumers,
  retryDelayMs,
  type PlatformEvent,
} from "../../src/platform/events/events";
import { db, resetDb, testEnv } from "../helpers/app";

const USER = "00000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  await resetDb();
  resetConsumers();
});

afterEach(() => {
  resetConsumers();
});

/**
 * 出来事を1つ書く（トランザクションの中で）。
 * @returns 出来事の番号
 */
async function emitOne() {
  return withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId: USER }));
}

describe("書く", () => {
  it("アプリがほかのアプリに伝える出来事は、allowNoConsumers なら届け先がなくても書かずに null（あれば書く）", async () => {
    const payload = { promotionId: "p1", occurredAt: "2026-11-13T00:00:00.000Z" };
    const none = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "threads.promotion_event.deleted", payload, { allowNoConsumers: true }));
    expect(none).toBeNull();
    const [count] = (await db().execute(sql`SELECT count(*)::int AS n FROM platform_events`)).rows as { n: number }[];
    expect(count!.n).toBe(0);
    // allowNoConsumers がなければ、今までどおり例外
    await expect(withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "threads.promotion_event.deleted", payload))).rejects.toThrow(/登録されていません/);
    registerConsumer("collect", "threads.promotion_event.deleted", async () => {});
    const id = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "threads.promotion_event.deleted", payload, { allowNoConsumers: true }));
    expect((await deliveriesOf(db(), [id!])).map((r) => r.consumer)).toEqual(["collect"]);
  });

  it("届け先ごとに pending の行ができる", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    registerConsumer("people", "user.withdrawn", async () => {});
    registerConsumer("people", "limits.changed", async () => {});
    const id = await emitOne();
    const rows = await deliveriesOf(db(), [id]);
    expect(rows.map((r) => [r.consumer, r.status, r.attempts]).sort()).toEqual([
      ["people", "pending", 0],
      ["threads", "pending", 0],
    ]);
  });

  it("書いたトランザクションが戻ったら、出来事も残らない", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    let id = "";
    await expect(
      withTransaction(testEnv.DATABASE_URL, async (tx) => {
        id = await emitEvent(tx, "user.withdrawn", { userId: USER });
        throw new Error("戻す");
      }),
    ).rejects.toThrow("戻す");
    expect(await deliveriesOf(db(), [id])).toEqual([]);
  });

  it("届け先が登録されていなければ例外（片づけを黙って飛ばさない）", async () => {
    await expect(emitOne()).rejects.toThrow(/受け取りが登録されていません/);
  });
});

describe("届ける", () => {
  it("受け取りに番号・種類・中身を渡し、done にする。2回目の処理では何もしない", async () => {
    const got: PlatformEvent[] = [];
    registerConsumer("threads", "user.withdrawn", async (e) => {
      got.push(e as PlatformEvent);
    });
    const id = await emitOne();
    expect(await deliverPendingEvents(testEnv)).toEqual({ delivered: 1, failed: 0 });
    expect(got.map((e) => [e.id, e.type, e.payload])).toEqual([[id, "user.withdrawn", { userId: USER }]]);
    const [row] = await deliveriesOf(db(), [id]);
    expect([row!.status, row!.attempts, row!.lastError]).toEqual(["done", 1, null]);
    expect(row!.deliveredAt).not.toBeNull();
    expect(await deliverPendingEvents(testEnv)).toEqual({ delivered: 0, failed: 0 });
    expect(got).toHaveLength(1);
  });

  it("失敗したら attempts を増やし、間をあけてやり直す（5分・10分・…・最大60分）", async () => {
    let fail = true;
    registerConsumer("threads", "user.withdrawn", async () => {
      if (fail) throw new Error("まだ");
    });
    const id = await emitOne();
    const t0 = new Date();
    expect(await deliverPendingEvents(testEnv, t0)).toEqual({ delivered: 0, failed: 1 });
    let [row] = await deliveriesOf(db(), [id]);
    expect([row!.status, row!.attempts, row!.lastError]).toEqual(["pending", 1, "Error: まだ"]);
    expect(row!.nextAttemptAt.getTime()).toBe(t0.getTime() + 5 * 60_000);
    // 時刻が来る前は届けない
    expect(await deliverPendingEvents(testEnv, new Date(t0.getTime() + 60_000))).toEqual({ delivered: 0, failed: 0 });
    fail = false;
    expect(await deliverPendingEvents(testEnv, new Date(t0.getTime() + 5 * 60_000))).toEqual({ delivered: 1, failed: 0 });
    [row] = await deliveriesOf(db(), [id]);
    expect([row!.status, row!.attempts]).toEqual(["done", 2]);
    expect([1, 2, 3, 4, 5, 9].map((n) => retryDelayMs(n) / 60_000)).toEqual([5, 10, 20, 40, 60, 60]);
  });

  it(`${MAX_DELIVERY_ATTEMPTS}回失敗したら failed にして止める`, async () => {
    registerConsumer("threads", "user.withdrawn", async () => {
      throw new Error("ずっと失敗");
    });
    const id = await emitOne();
    let at = Date.now();
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await deliverPendingEvents(testEnv, new Date(at));
      at += 61 * 60_000;
    }
    const [row] = await deliveriesOf(db(), [id]);
    expect([row!.status, row!.attempts]).toEqual(["failed", MAX_DELIVERY_ATTEMPTS]);
    expect(await deliverPendingEvents(testEnv, new Date(at))).toEqual({ delivered: 0, failed: 0 });
  });

  it("受け取りの途中で止まっても、借りたときに回数を数えている（いつかは failed で止まる）", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    const id = await emitOne();
    // 借りただけの状態（受け取りが終わる前に止まった）を作る：attempts を進め、時刻を過ぎた状態に戻す
    await db().execute(sql`UPDATE platform_event_deliveries SET attempts = attempts + 1, next_attempt_at = now() - interval '1 minute' WHERE event_id = ${id}`);
    expect(await deliverPendingEvents(testEnv)).toEqual({ delivered: 1, failed: 0 });
    const [row] = await deliveriesOf(db(), [id]);
    expect([row!.status, row!.attempts]).toEqual(["done", 2]);
  });

  it("試した回数が上限に達したまま pending の行は、受け取りを呼ばずに failed にする（途中で止まり続けたとき）", async () => {
    let called = 0;
    registerConsumer("threads", "user.withdrawn", async () => {
      called += 1;
    });
    const id = await emitOne();
    await db().execute(
      sql`UPDATE platform_event_deliveries SET attempts = ${MAX_DELIVERY_ATTEMPTS}, next_attempt_at = now() - interval '1 minute' WHERE event_id = ${id}`,
    );
    expect(await deliverPendingEvents(testEnv)).toEqual({ delivered: 0, failed: 1 });
    expect(called).toBe(0);
    const [row] = await deliveriesOf(db(), [id]);
    expect([row!.status, row!.lastError]).toEqual(["failed", "受け取りの途中で止まった"]);
  });

  it("受け取りが登録されていない届け先は失敗として残す", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    const id = await emitOne();
    resetConsumers();
    expect(await deliverPendingEvents(testEnv)).toEqual({ delivered: 0, failed: 1 });
    const [row] = await deliveriesOf(db(), [id]);
    expect(row!.lastError).toMatch(/受け取りが登録されていません/);
  });

  it("届け先ごとに別々：片方が失敗しても、もう片方は done", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    registerConsumer("people", "user.withdrawn", async () => {
      throw new Error("x");
    });
    const id = await emitOne();
    expect(await deliverPendingEvents(testEnv)).toEqual({ delivered: 1, failed: 1 });
    const rows = await deliveriesOf(db(), [id]);
    expect(rows.map((r) => [r.consumer, r.status]).sort()).toEqual([
      ["people", "pending"],
      ["threads", "done"],
    ]);
  });
});

describe("片づけ", () => {
  it("すべて done で30日たった出来事だけを消す", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    const done = await emitOne();
    await deliverPendingEvents(testEnv);
    const pending = await emitOne();
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await purgeDeliveredEvents(db(), later)).toBe(1);
    expect(await deliveriesOf(db(), [done])).toEqual([]);
    expect(await deliveriesOf(db(), [pending])).toHaveLength(1);
  });
});

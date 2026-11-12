// 出来事の届けの関所（KV）。5分ごとの届けは、用がない回はDBを起こさない（費用のため。docs/architecture.md「定期処理は用がないときDBを起こさない」）。
// 関所は5分ごとの届けだけが書き、起こす知らせは出来事を書く側だけが書く（自動投稿の関所と同じ形。PR #109 のセルフレビュー）。
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import { withTransaction } from "../../src/kernel/db/client";
import { nextEventCheckAt, readEventGate, shouldDeliver, wakeEventDelivery, type EventGateState } from "../../src/platform/events/delivery-gate";
import { deliveriesOf, emitEvent, registerConsumer, resetConsumers, retryDelayMs } from "../../src/platform/events/events";
import { db, makeApp, resetDb, testEnv } from "../helpers/app";
import { TESTER_OPERATOR, callT } from "../helpers/tester-invites";

const USER = "00000000-0000-4000-8000-000000000001";
const GATE = "platform-events:gate";
const WAKE = "platform-events:wake";
const AUTO_POST_CRON = "*/5 * * * *";
let failing = false;

beforeEach(async () => {
  await resetDb();
  resetConsumers();
  failing = false;
  registerConsumer("people", "user.withdrawn", async () => {
    if (failing) throw new Error("受け取りの失敗");
  });
  for (const k of [GATE, WAKE]) await testEnv.AUTOPOST_KV.delete(k);
  // 自動投稿の関所は眠らせておく（このテストは出来事の届けだけを見る）
  const now = new Date();
  await testEnv.AUTOPOST_KV.put("autopost:gate", JSON.stringify({ nextCheckAt: new Date(now.getTime() + 86_400_000).toISOString(), runStartedAt: now.toISOString() }));
  await testEnv.AUTOPOST_KV.delete("autopost:wake");
});

afterEach(() => {
  resetConsumers();
});

const emitOne = () => withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId: USER }));

/** 5分ごとの定期処理を1回動かす。 */
async function runCron() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: AUTO_POST_CRON }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

const statusOf = async (id: string) => (await deliveriesOf(db(), [id]))[0]?.status;

describe("関所の判定", () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 13, 0, 0, 0) + ms).toISOString();
  const state = (gate: EventGateState["gate"], wakeAt: string | null = null): EventGateState => ({ readable: true, gate, wakeAt });
  const now = new Date(at(10 * 60_000));

  it("関所がない・読めないときは届ける", () => {
    expect(shouldDeliver(state(null), now)).toBe(true);
    expect(shouldDeliver({ readable: false, gate: null, wakeAt: null }, now)).toBe(true);
  });

  it("次に見る時刻の前で、起こす知らせがなければ届けない。時刻を過ぎたら届ける", () => {
    const gate = { nextCheckAt: at(20 * 60_000), runStartedAt: at(0) };
    expect(shouldDeliver(state(gate), now)).toBe(false);
    expect(shouldDeliver(state(gate), new Date(at(20 * 60_000)))).toBe(true);
  });

  it("起こす知らせが前回の開始時刻より後（2分前まで）なら届ける。それより前の知らせでは届けない", () => {
    const gate = { nextCheckAt: at(20 * 60_000), runStartedAt: at(5 * 60_000) };
    expect(shouldDeliver(state(gate, at(4 * 60_000)), now)).toBe(true);
    expect(shouldDeliver(state(gate, at(2 * 60_000)), now)).toBe(false);
  });

  it("次に見る時刻：届けがなければ24時間後、過去なら今、未来ならその時刻", () => {
    const n = new Date(at(0));
    expect(nextEventCheckAt(n, null).toISOString()).toBe(at(86_400_000));
    expect(nextEventCheckAt(n, new Date(at(-60_000))).toISOString()).toBe(at(0));
    expect(nextEventCheckAt(n, new Date(at(5 * 60_000))).toISOString()).toBe(at(5 * 60_000));
  });
});

describe("5分ごとの届け", () => {
  it("関所がなければ届け、届けるものがなくなったら24時間眠る関所を書く", async () => {
    const id = await emitOne();
    const before = Date.now();
    await runCron();
    expect(await statusOf(id)).toBe("done");
    const { gate } = await readEventGate(testEnv.AUTOPOST_KV);
    expect(Date.parse(gate!.nextCheckAt) - Date.parse(gate!.runStartedAt)).toBe(86_400_000);
    expect(Date.parse(gate!.runStartedAt)).toBeGreaterThanOrEqual(before);
  });

  it("関所が眠っていて起こす知らせがなければ、DBの届けをしない", async () => {
    await runCron(); // 関所を書く（届けるものなし）
    const id = await emitOne();
    await runCron();
    expect(await statusOf(id)).toBe("pending");
  });

  it("起こす知らせがあれば、関所が眠っていても届ける", async () => {
    await runCron();
    await wakeEventDelivery(testEnv.AUTOPOST_KV);
    const id = await emitOne();
    await runCron();
    expect(await statusOf(id)).toBe("done");
  });

  it("受け取りが失敗したら、やり直しの時刻を次に見る時刻にする", async () => {
    failing = true;
    const id = await emitOne();
    await runCron();
    expect(await statusOf(id)).toBe("pending");
    const { gate } = await readEventGate(testEnv.AUTOPOST_KV);
    expect(Date.parse(gate!.nextCheckAt) - Date.parse(gate!.runStartedAt)).toBe(retryDelayMs(1));
  });
});

describe("起こす知らせを書く側", () => {
  it("運営者が上限の既定値を保存すると、起こす知らせを書く", async () => {
    registerConsumer("people", "limits.changed", async () => {});
    const before = Date.now();
    const res = await callT(makeApp(), "PUT", "/api/operator/limits", { user: TESTER_OPERATOR, body: { limits: { accounts: 5, daily_posts: 8 } } });
    expect(res.status).toBe(200);
    const { wakeAt } = await readEventGate(testEnv.AUTOPOST_KV);
    expect(Date.parse(wakeAt!)).toBeGreaterThanOrEqual(before);
  });
});

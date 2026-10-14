// 定期処理の関所（specs/005-auto-post research.md R3、contracts/auto-post-job.md 手順0・7）
import { neon } from "@neondatabase/serverless";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import worker from "../../src/index";
import { runAutoPost } from "../../src/services/auto-post-runner";
import { fake, makeApp, resetDb, testEnv, tokenConnectNew } from "../helpers/app";
import { addMin, connectedAccount, jst, setSchedule } from "../helpers/auto-post";

const app = makeApp();
const KV = () => testEnv.AUTOPOST_KV;
const NOON = jst("2030-01-10 12:00");

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await KV().delete("autopost:gate");
  await KV().delete("metrics:catchup");
  await KV().delete("autopost:wake");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** DB（local-neon-http-proxy の /sql と WebSocket）への fetch の回数を数える。 */
function countDbCalls() {
  const original = globalThis.fetch;
  let n = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/sql") || url.includes("db.localtest.me")) n += 1;
      return original(input, init);
    },
  );
  return () => n;
}

const gate = async () =>
  JSON.parse((await KV().get("autopost:gate"))!) as { nextCheckAt: string; runStartedAt: string };

describe("関所（DBに触れずに終える）", () => {
  it("nextCheckAt が未来で wake がなければ、DBに触れずに終える", async () => {
    await KV().put(
      "autopost:gate",
      JSON.stringify({
        nextCheckAt: addMin(NOON, 30).toISOString(),
        runStartedAt: addMin(NOON, -5).toISOString(),
      }),
    );
    const calls = countDbCalls();
    const r = await runAutoPost(testEnv, NOON);
    expect(r.ran).toBe(false);
    expect(calls()).toBe(0);
  });

  it("wake.at が runStartedAt より後なら、DBの処理をする", async () => {
    await KV().put(
      "autopost:gate",
      JSON.stringify({
        nextCheckAt: addMin(NOON, 30).toISOString(),
        runStartedAt: addMin(NOON, -5).toISOString(),
      }),
    );
    await KV().put("autopost:wake", JSON.stringify({ at: addMin(NOON, -1).toISOString() }));
    const r = await runAutoPost(testEnv, NOON);
    expect(r.ran).toBe(true);
  });

  it("関所の値が壊れているときは、DBの処理をする（安全側）", async () => {
    await KV().put("autopost:gate", "not json");
    expect((await runAutoPost(testEnv, NOON)).ran).toBe(true);
  });

  it("次に見る時刻は、次の予定の時刻（間に一定の間隔の見直しは入らない）。予定がなければ翌日の3:00（反応数の補い。specs/006）", async () => {
    await runAutoPost(testEnv, NOON);
    expect(await gate()).toEqual({
      nextCheckAt: jst("2030-01-11 03:00").toISOString(),
      runStartedAt: NOON.toISOString(),
    });

    const { accountId } = await connectedAccount("u1", app);
    await setSchedule(accountId, { slotMinutes: [720, 1260] });
    // 設定の保存では、API が autopost:wake を書く（ここでは DB に直接入れたので、同じことをする）
    await KV().put("autopost:wake", JSON.stringify({ at: addMin(NOON, 1).toISOString() }));
    const r = await runAutoPost(testEnv, addMin(NOON, 5));
    expect(r.ran).toBe(true);
    expect((await gate()).nextCheckAt).toBe(jst("2030-01-10 21:00").toISOString());
  });

  it("トークンの確かめ直しの時刻が、次に見る時刻の候補に入る（specs/010 research.md R8）", async () => {
    await runAutoPost(testEnv, NOON);
    const base = (await gate()).nextCheckAt;
    await fake.addUser("9003", "cafe_b");
    const { res } = await tokenConnectNew(app, "u1", await fake.issueToken({ user: "9003", debug: false }));
    expect(res.status).toBe(200);
    // トークンの追加は autopost:wake を書く
    expect(await KV().get("autopost:wake")).not.toBeNull();
    const at = addMin(NOON, 30);
    await neon(testEnv.DATABASE_URL)`UPDATE threads_connections SET recheck_at = ${at.toISOString()}`;
    // 試験の時刻（2030年）に合わせて、知らせの時刻を入れ直す
    await KV().put("autopost:wake", JSON.stringify({ at: addMin(NOON, 1).toISOString() }));
    await runAutoPost(testEnv, addMin(NOON, 5));
    expect((await gate()).nextCheckAt).toBe(at.toISOString());
    expect(base).toBe(jst("2030-01-11 03:00").toISOString());
  });

  it("関所の書き込みに失敗すると、前の値（過ぎた時刻）が残り、次の回もDBの処理が動く", async () => {
    await KV().put(
      "autopost:gate",
      JSON.stringify({
        nextCheckAt: addMin(NOON, -1).toISOString(),
        runStartedAt: addMin(NOON, -10).toISOString(),
      }),
    );
    const failingKv = {
      get: KV().get.bind(KV()),
      put: async () => {
        throw new Error("kv down");
      },
      delete: KV().delete.bind(KV()),
    } as unknown as KVNamespace;
    expect((await runAutoPost({ ...testEnv, AUTOPOST_KV: failingKv }, NOON)).ran).toBe(true);
    expect((await runAutoPost(testEnv, addMin(NOON, 5))).ran).toBe(true);
  });

  it("Cron の回は、予定時刻（scheduledTime）ではなく実際の開始時刻で判断する（PR #6 のCodexレビュー）", async () => {
    const before = Date.now();
    const controller = createScheduledController({
      cron: "*/5 * * * *",
      // 2時間遅れて始まった回
      scheduledTime: before - 2 * 3600_000,
    });
    const ctx = createExecutionContext();
    await worker.scheduled(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(Date.parse((await gate()).runStartedAt)).toBeGreaterThanOrEqual(before);
  });

  it("その日の補いが済んでいなければ、3:00より前の回の次に見る時刻は今日の3:00（specs/006 contracts/metrics-job.md 手順7）", async () => {
    await KV().delete("metrics:catchup");
    await runAutoPost(testEnv, jst("2030-01-10 01:00"));
    expect((await gate()).nextCheckAt).toBe(jst("2030-01-10 03:00").toISOString());
    await runAutoPost(testEnv, jst("2030-01-10 03:01"));
    expect(await KV().get("metrics:catchup")).toBe("2030-01-10");
    expect((await gate()).nextCheckAt).toBe(jst("2030-01-11 03:00").toISOString());
  });
});

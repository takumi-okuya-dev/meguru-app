// 定期処理の関所（specs/005-auto-post research.md R3、contracts/auto-post-job.md 手順0・7）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAutoPost } from "../../src/services/auto-post-runner";
import { fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { addMin, connectedAccount, jst, setSchedule } from "../helpers/auto-post";

const app = makeApp();
const KV = () => testEnv.AUTOPOST_KV;
const NOON = jst("2030-01-10 12:00");

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await KV().delete("autopost:gate");
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

  it("次に見る時刻は、次の予定の時刻（間に一定の間隔の見直しは入らない）。予定がなければ24時間後", async () => {
    await runAutoPost(testEnv, NOON);
    expect(await gate()).toEqual({
      nextCheckAt: addMin(NOON, 1440).toISOString(),
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
});

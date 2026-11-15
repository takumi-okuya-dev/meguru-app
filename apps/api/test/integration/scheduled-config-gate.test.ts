// Cron の入口にも設定の関所を置く（セキュリティ監査 run-1 の
// `apps-api.scheduled-entrypoint-bypasses-config-gate`）。
//
// `validateConfig` の呼び出しは app.ts の2か所だけで、どちらも `fetch` の経路だった。
// `scheduled` には設定の前提条件が1つも無く、問題の一覧は env をキーにした WeakMap に
// そのミドルウェア内で記憶されるので、Cron の経路からは覗けない。
//
// security上の意味を持たせていたのは1つの変数。`validateConfig` は `BILLING_ENABLED` が
// `"true"`／`"false"` 以外なら意図的に fail-close するのに、`billingModeOf` は
// `=== "true"` 以外のすべてを黙って「課金オフ」に写していた。すると `entitlementOf` が
// 契約の状態を読まずに全オーナーへ全権を返し、Cron の3つの公開の関所はすべてその1つの
// 源を見ているので、**APIは全リクエストを拒みながら Cron は実際にThreadsへ投稿する**
// （specs/013 FR-063 違反）。
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/kernel/env";
import worker from "../../src/index";
import { fake, resetDb, testEnv } from "../helpers/app";

const AUTO_POST_CRON = "*/5 * * * *";
const DAILY_CRON = "0 18 * * *";

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await testEnv.AUTOPOST_KV.delete("autopost:gate");
  await testEnv.AUTOPOST_KV.delete("metrics:catchup");
  await testEnv.AUTOPOST_KV.delete("autopost:wake");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * DB（local-neon-http-proxy）と fake Threads への fetch の回数を数える。
 * @returns 今までの回数を返す関数
 */
function countOutbound() {
  const original = globalThis.fetch;
  let n = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/sql") || url.includes("db.localtest.me") || url.includes(testEnv.THREADS_GRAPH_BASE_URL)) n += 1;
    return original(input, init);
  });
  return () => n;
}

/**
 * Cron を1回動かす。
 * @param cron - どちらの Cron か
 * @param env - Workers のバインディング
 */
async function run(cron: string, env: Env) {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron }), env, ctx);
  await waitOnExecutionContext(ctx);
}

describe("設定に誤りがあるとき、Cron は何もしない", () => {
  it.each([AUTO_POST_CRON, DAILY_CRON])("%s は、DBにもThreadsにも触らない", async (cron) => {
    const broken = { ...testEnv, IDENTIFIER_HASH_KEY: "REPLACE_WITH_32_BYTES_BASE64" } as Env;
    const calls = countOutbound();
    await run(cron, broken);
    expect(calls()).toBe(0);
    // KVの関所にも触らない（触ると次に見る時刻が進んでしまう）
    expect(await testEnv.AUTOPOST_KV.get("autopost:gate")).toBeNull();
  });

  it("BILLING_ENABLED が true／false 以外なら、Cron は何もしない（FR-063）", async () => {
    // fetch 側は CONFIG_ERROR で全部止まるのに Cron 側は全員を全権として扱う、という
    // 食い違いが起きていた値
    const calls = countOutbound();
    await run(AUTO_POST_CRON, { ...testEnv, BILLING_ENABLED: "TRUE" } as Env);
    expect(calls()).toBe(0);
  });

  it("設定が正しければ、これまでどおり関所まで進む", async () => {
    const calls = countOutbound();
    await run(AUTO_POST_CRON, testEnv);
    // KVの関所を読み書きし、やることがあるかDBを見る
    expect(calls()).toBeGreaterThan(0);
  });
});

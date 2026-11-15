import { defineConfig } from "@playwright/test";
import { loadLocalEnv, portOffset } from "./env";

// Clerk のキー（apps/api/.dev.vars）と、ログインする人のメールアドレス（e2e/.env.local）を読む。環境変数にあればそちらを使う
loadLocalEnv();

// 作業場所（git worktree）を分けているときは、すべてのポートにずらし幅を足す（.env.worktree。README「手元で同時に進める」）
const o = portOffset();
const PORT = {
  fakeThreads: 8790 + o,
  api: 8787 + o,
  apiInspector: 9229 + o,
  web: 5173 + o,
  fakeStripe: 8791 + o,
  billingApi: 8788 + o,
  billingInspector: 9230 + o,
  billingWeb: 5174 + o,
};

// E2E：Web・API・偽のThreadsサーバーを起動し、ログインは @clerk/testing で自動化する（research.md R12）
// 本物のMetaの認可画面は使わない（quickstart.md の手動確認で行う）
export default defineConfig({
  testDir: "./tests",
  // すべてのファイルが同じローカルのDBを空にして使うので、ファイルどうしも並べて流さない（PR #9 のCodexレビュー）
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT.web}`,
    trace: "on-first-retry",
  },
  // 決済のE2E（specs/013-billing T060）は、決済ONのAPI（8788、偽のStripe 8791）と、それに向けたWeb（5174）で流す（ポートは、ずらし幅を足す前の値）。
  // ほかのE2Eは今までどおり決済OFF（apps/api/.dev.vars の BILLING_ENABLED=false）で流す
  projects: [
    { name: "default", testIgnore: /billing\.spec\.ts/ },
    {
      name: "billing",
      testMatch: /billing\.spec\.ts/,
      use: { baseURL: `http://localhost:${PORT.billingWeb}` },
    },
  ],
  globalSetup: "./global-setup.ts",
  webServer: [
    {
      command: "pnpm --filter api exec tsx test/fake-threads/serve.ts",
      port: PORT.fakeThreads,
      env: { FAKE_THREADS_PORT: String(PORT.fakeThreads) },
      reuseExistingServer: true,
    },
    {
      // Threads は偽サーバーに向ける。Clerk・DB・鍵などは apps/api/.dev.vars から読む（README 参照）
      command:
        `pnpm --filter api exec wrangler dev --port ${PORT.api} --inspector-port ${PORT.apiInspector}` +
        // テスター招待の申し込み（specs/024）は結合テストで確かめる。ここでは「Threadsで許可する」をすぐに押せる審査の後の形にする
        " --var THREADS_ACCESS_MODE:public" +
        ` --var THREADS_AUTH_BASE_URL:http://localhost:${PORT.fakeThreads}` +
        ` --var THREADS_GRAPH_BASE_URL:http://localhost:${PORT.fakeThreads}` +
        ` --var THREADS_REDIRECT_URI:http://localhost:${PORT.api}/api/threads/callback`,
      port: PORT.api,
      reuseExistingServer: true,
    },
    {
      // ポートは vite.config.ts が .env.worktree から決める（PORT.web と同じ）
      command: "pnpm --filter web dev",
      port: PORT.web,
      reuseExistingServer: true,
    },
    // ---- 決済のE2E（specs/013-billing T060）----
    {
      command: "pnpm --filter api exec tsx test/fake-stripe/serve.ts",
      port: PORT.fakeStripe,
      env: { FAKE_STRIPE_PORT: String(PORT.fakeStripe) },
      reuseExistingServer: true,
    },
    {
      // 決済ON。Stripeは偽のStripeに向ける（鍵・料金のIDは形だけの値）。状態は別の場所に置き、8787 と混ぜない
      command:
        `pnpm --filter api exec wrangler dev --port ${PORT.billingApi} --inspector-port ${PORT.billingInspector} --persist-to .wrangler/state-billing` +
        ` --var THREADS_AUTH_BASE_URL:http://localhost:${PORT.fakeThreads}` +
        ` --var THREADS_GRAPH_BASE_URL:http://localhost:${PORT.fakeThreads}` +
        ` --var THREADS_REDIRECT_URI:http://localhost:${PORT.billingApi}/api/threads/callback` +
        ` --var WEB_ORIGIN:http://localhost:${PORT.billingWeb}` +
        " --var BILLING_ENABLED:true" +
        " --var STRIPE_SECRET_KEY:sk_test_E2eFakeStripeKey00" +
        " --var STRIPE_WEBHOOK_SECRET:whsec_E2eFakeWebhookSecret" +
        " --var STRIPE_PRICE_ID:price_E2eTiered" +
        ` --var STRIPE_API_BASE_URL:http://localhost:${PORT.fakeStripe}`,
      port: PORT.billingApi,
      reuseExistingServer: true,
    },
    {
      command: `pnpm --filter web exec vite --port ${PORT.billingWeb} --strictPort`,
      port: PORT.billingWeb,
      reuseExistingServer: true,
      env: { VITE_API_BASE_URL: `http://localhost:${PORT.billingApi}` },
    },
  ],
});

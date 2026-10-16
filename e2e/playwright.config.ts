import { defineConfig } from "@playwright/test";
import { loadLocalEnv } from "./env";

// Clerk のキー（apps/api/.dev.vars）と、チーム運用の3人（e2e/.env.local）を読む。環境変数にあればそちらを使う
loadLocalEnv();

// E2E：Web・API・偽のThreadsサーバーを起動し、ログインは @clerk/testing で自動化する（research.md R12）
// 本物のMetaの認可画面は使わない（quickstart.md の手動確認で行う）
export default defineConfig({
  testDir: "./tests",
  // すべてのファイルが同じローカルのDBを空にして使うので、ファイルどうしも並べて流さない（PR #9 のCodexレビュー）
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  // 決済のE2E（specs/013-billing T060）は、決済ONのAPI（8788、偽のStripe 8791）と、それに向けたWeb（5174）で流す。
  // ほかのE2Eは今までどおり決済OFF（apps/api/.dev.vars の BILLING_ENABLED=false）で流す
  projects: [
    { name: "default", testIgnore: /billing\.spec\.ts/ },
    { name: "billing", testMatch: /billing\.spec\.ts/, use: { baseURL: "http://localhost:5174" } },
  ],
  globalSetup: "./global-setup.ts",
  webServer: [
    {
      command: "pnpm --filter api exec tsx test/fake-threads/serve.ts",
      port: 8790,
      reuseExistingServer: true,
    },
    {
      // Threads は偽サーバーに向ける。Clerk・DB・鍵などは apps/api/.dev.vars から読む（README 参照）
      command:
        "pnpm --filter api exec wrangler dev --port 8787" +
        " --var THREADS_AUTH_BASE_URL:http://localhost:8790" +
        " --var THREADS_GRAPH_BASE_URL:http://localhost:8790" +
        " --var THREADS_REDIRECT_URI:http://localhost:8787/api/threads/callback",
      port: 8787,
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter web dev",
      port: 5173,
      reuseExistingServer: true,
    },
    // ---- 決済のE2E（specs/013-billing T060）----
    {
      command: "pnpm --filter api exec tsx test/fake-stripe/serve.ts",
      port: 8791,
      reuseExistingServer: true,
    },
    {
      // 決済ON。Stripeは偽のStripeに向ける（鍵・料金のIDは形だけの値）。状態は別の場所に置き、8787 と混ぜない
      command:
        "pnpm --filter api exec wrangler dev --port 8788 --inspector-port 9230 --persist-to .wrangler/state-billing" +
        " --var THREADS_AUTH_BASE_URL:http://localhost:8790" +
        " --var THREADS_GRAPH_BASE_URL:http://localhost:8790" +
        " --var THREADS_REDIRECT_URI:http://localhost:8788/api/threads/callback" +
        " --var WEB_ORIGIN:http://localhost:5174" +
        " --var BILLING_ENABLED:true" +
        " --var STRIPE_SECRET_KEY:sk_test_E2eFakeStripeKey00" +
        " --var STRIPE_WEBHOOK_SECRET:whsec_E2eFakeWebhookSecret" +
        " --var STRIPE_PRICE_ID:price_E2eTiered" +
        " --var STRIPE_API_BASE_URL:http://localhost:8791",
      port: 8788,
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter web exec vite --port 5174 --strictPort",
      port: 5174,
      reuseExistingServer: true,
      env: { VITE_API_BASE_URL: "http://localhost:8788" },
    },
  ],
});

import { defineConfig } from "@playwright/test";
import { loadLocalEnv } from "./env";

// Clerk のキー（apps/api/.dev.vars）と、チーム運用の3人（e2e/.env.local）を読む。環境変数にあればそちらを使う
loadLocalEnv();

// E2E：Web・API・偽のThreadsサーバーを起動し、ログインは @clerk/testing で自動化する（research.md R12）
// 本物のMetaの認可画面は使わない（quickstart.md の手動確認で行う）
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
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
  ],
});

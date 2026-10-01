import { defineConfig } from "@playwright/test";

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
      command: "pnpm --filter api dev",
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

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { testBindings } from "./test/env.ts";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.toml" },
            miniflare: { bindings: testBindings("http://127.0.0.1:1", "postgres://unused@localhost/unused") },
          }),
        ],
        test: { name: "unit", include: ["test/unit/**/*.test.ts"] },
      },
      {
        plugins: [
          cloudflareTest(({ inject }) => ({
            wrangler: { configPath: "./wrangler.toml" },
            miniflare: {
              bindings: testBindings(inject("fakeThreadsUrl"), inject("databaseUrl"), inject("fakeStripeUrl")),
            },
          })),
        ],
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          // 同じDBを使うので、ファイルは順番に実行する
          fileParallelism: false,
          testTimeout: 30_000,
          // 準備（beforeEach）も、表を空にしてから取り込みなどで中身を作るので、テストと同じ長さまで待つ
          // （初めの値の10秒では、CI が混んでいると時間切れになることがあった。人物メモの outreach-work.test.ts）
          hookTimeout: 30_000,
        },
      },
      {
        // マイグレーションのテスト（specs/011 T004）。使い捨てのDBに pg で直接つなぐので、Workers の外（Node）で動かす
        test: { name: "migration", include: ["test/migration/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
      },
      {
        // リポジトリの設定ファイルの検査（.github/workflows など）。ファイルを直に読むので Node で動かす
        test: { name: "repo", include: ["test/repo/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});

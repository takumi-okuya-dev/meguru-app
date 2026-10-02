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
              bindings: testBindings(inject("fakeThreadsUrl"), inject("databaseUrl")),
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
        },
      },
    ],
  },
});

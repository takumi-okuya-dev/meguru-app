// 結合テストの準備（Node 上で動く）：偽のThreadsサーバーの起動と、DBのマイグレーション
import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { loadWorktreeEnv } from "../scripts/worktree-env";
import { createFakeStripe } from "./fake-stripe/server";
import { createFakeThreads } from "./fake-threads/server";

// 作業場所を分けているときは、その作業場所のDBを使う（scripts/worktree-env.ts）
loadWorktreeEnv();
const DIRECT_URL = process.env.TEST_DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower";
// Workers からは local-neon-http-proxy 経由で接続する
const PROXY_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@db.localtest.me:5432/threads_grower";

declare module "vitest" {
  export interface ProvidedContext {
    fakeThreadsUrl: string;
    fakeStripeUrl: string;
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const pool = new pg.Pool({ connectionString: DIRECT_URL });
  try {
    await pool.query("select 1");
  } catch (err) {
    throw new Error(
      `結合テストにはローカルのDBが必要です。リポジトリのルートで "docker compose up -d" を実行してください（${String(err)}）`,
      { cause: err },
    );
  }
  await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  await pool.end();

  const app = createFakeThreads();
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  // 偽のStripe（specs/013-billing research.md R5）
  const stripe = serve({ fetch: createFakeStripe().fetch, port: 0 });
  await new Promise<void>((resolve) => stripe.once("listening", () => resolve()));
  const stripeAddress = stripe.address();
  const stripePort = typeof stripeAddress === "object" && stripeAddress ? stripeAddress.port : 0;

  project.provide("fakeThreadsUrl", `http://127.0.0.1:${port}`);
  project.provide("fakeStripeUrl", `http://127.0.0.1:${stripePort}`);
  project.provide("databaseUrl", PROXY_URL);

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => stripe.close(() => resolve()));
  };
}

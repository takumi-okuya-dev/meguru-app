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

// 作業場所（git worktree）をまたいで、結合テストとE2Eを1つずつ流すためのロックの番号（e2e/global-setup.ts と同じ値）。
// DBは作業場所ごとに分かれているが、Workers からつなぐ local-neon-http-proxy は1つで、2つを同時に流すと
// 認証の問い合わせが追いつかず「Control plane request failed」で落ちるため（README「手元で同時に進める」）
const CROSS_WORKTREE_LOCK = 72_013_001;

/**
 * ほかの作業場所の結合テスト・E2Eが終わるまで待ち、ロックを取る。ロックはこの接続を閉じると外れる
 * （テストが途中で止まっても、接続が切れて外れる）。
 * @returns ロックを外す関数
 */
async function waitForOtherWorktrees(): Promise<() => Promise<void>> {
  // アドバイザリーロックはDBごとなので、どの作業場所にもある postgres のDBで取る
  const url = new URL(DIRECT_URL);
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const got = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [CROSS_WORKTREE_LOCK]);
  if (!got.rows[0]?.ok) {
    console.log("ほかの作業場所で結合テストかE2Eが流れています。終わるまで待ちます…");
    await client.query("select pg_advisory_lock($1)", [CROSS_WORKTREE_LOCK]);
  }
  return async () => {
    await client.end();
  };
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
  await pool.end();
  const unlock = await waitForOtherWorktrees();
  const migrating = new pg.Pool({ connectionString: DIRECT_URL });
  await migrate(drizzle(migrating), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  await migrating.end();

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
    await unlock();
  };
}

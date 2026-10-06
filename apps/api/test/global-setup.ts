// 結合テストの準備（Node 上で動く）：偽のThreadsサーバーの起動と、DBのマイグレーション
import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { createFakeThreads } from "./fake-threads/server";

const DIRECT_URL = process.env.TEST_DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower";
// Workers からは local-neon-http-proxy 経由で接続する
const PROXY_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@db.localtest.me:5432/threads_grower";

declare module "vitest" {
  export interface ProvidedContext {
    fakeThreadsUrl: string;
    databaseUrl: string;
  }
}

/**
 * 同じパスワードのまま、SCRAM の反復回数を1回にして保存し直す（Postgres 16 以降）。
 * local-neon-http-proxy は1クエリごとに SCRAM の認証で接続し直すため、既定の4096回ではテストの大半がこの計算になる
 * （CI で結合テストが20分を超えた原因。1クエリ 約230ms → 数ms）。
 * @param pool - 直接の接続
 * @param url - 直接の接続の文字列（パスワードを取り出す）
 */
async function useCheapScram(pool: pg.Pool, url: string) {
  const password = decodeURIComponent(new URL(url).password);
  if (!password) return;
  const client = await pool.connect();
  try {
    await client.query("SET scram_iterations = 1");
    const { rows } = await client.query<{ sql: string }>(
      "SELECT format('ALTER ROLE CURRENT_USER PASSWORD %L', $1::text) AS sql",
      [password],
    );
    await client.query(rows[0]!.sql);
  } catch (err) {
    // 古い Postgres では scram_iterations がない。遅いだけなので続ける
    console.warn(`SCRAM の反復回数を下げられませんでした（${String(err)}）`);
  } finally {
    client.release();
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
  await useCheapScram(pool, DIRECT_URL);
  await pool.end();

  const app = createFakeThreads();
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  project.provide("fakeThreadsUrl", `http://127.0.0.1:${port}`);
  project.provide("databaseUrl", PROXY_URL);

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}

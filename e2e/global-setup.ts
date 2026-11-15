import { clerkSetup } from "@clerk/testing/playwright";
import pg from "pg";

// 作業場所（git worktree）をまたいで、結合テストとE2Eを1つずつ流すためのロックの番号（apps/api/test/global-setup.ts と同じ値）。
// DBは作業場所ごとに分かれているが、APIからつなぐ local-neon-http-proxy は1つで、同時に流すと落ちるため（README「手元で同時に進める」）
const CROSS_WORKTREE_LOCK = 72_013_001;

export default async function globalSetup() {
  // アドバイザリーロックはDBごとなので、どの作業場所にもある postgres のDBで取る。接続を閉じると外れる
  const client = new pg.Client({ connectionString: "postgres://postgres:postgres@localhost:5432/postgres" });
  await client.connect();
  const got = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [CROSS_WORKTREE_LOCK]);
  if (!got.rows[0]?.ok) {
    console.log("ほかの作業場所で結合テストかE2Eが流れています。終わるまで待ちます…");
    await client.query("select pg_advisory_lock($1)", [CROSS_WORKTREE_LOCK]);
  }
  await clerkSetup();
  return async () => {
    await client.end();
  };
}

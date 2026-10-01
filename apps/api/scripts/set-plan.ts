// 運営者が Account のプランを手動で変更するスクリプト（research.md R9）。課金feature（FR-12）ができるまでの暫定。
// 使い方: pnpm --filter api admin:set-plan <accountId> <plan>
// 接続先: DATABASE_URL_DIRECT（Postgres に直接つなぐURL。既定はローカルの docker compose）
import { isPlan, PLANS } from "@threads-grower/shared";
import pg from "pg";

const [accountId, plan] = process.argv.slice(2);
if (!accountId || !plan || !isPlan(plan)) {
  console.error(`使い方: admin:set-plan <accountId> <plan>\nplan は ${PLANS.join(" / ")} のどれか`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower",
});
await client.connect();
try {
  const res = await client.query(
    "UPDATE accounts SET plan = $2, updated_at = now() WHERE id = $1 RETURNING id, username, plan",
    [accountId, plan],
  );
  if (res.rowCount === 0) {
    console.error(`Account ${accountId} は見つかりませんでした`);
    process.exitCode = 1;
  } else {
    const row = res.rows[0] as { id: string; username: string; plan: string };
    console.log(`@${row.username}（${row.id}）のプランを ${row.plan} にしました`);
  }
} finally {
  await client.end();
}

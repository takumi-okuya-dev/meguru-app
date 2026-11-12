// 手動確認のデータ（specs/006-performance-feedback quickstart.md 手順1〜3・8、tasks.md T002）。ローカルのDBだけで動く。
// 使い方: pnpm --filter api seed:performance <accountId> [件数]
//   件数を省略すると、確認用の決まったデータ（確定待ち・遅れて確定・判定・低調6件など）を作る。
//   件数を指定すると、その件数の確定した投稿済みを作る（表示の速さの確認用。例：500）。
// 接続先: DATABASE_URL_DIRECT（既定はローカルの docker compose）。localhost 以外には書き込まない。
import pg from "pg";
import { loadWorktreeEnv } from "./worktree-env";

const [accountId, countArg] = process.argv.slice(2);
if (!accountId) {
  console.error("使い方: seed:performance <accountId> [件数]");
  process.exit(1);
}
// 作業場所を分けているときは、その作業場所のDB（scripts/worktree-env.ts）
loadWorktreeEnv();
const url = process.env.DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower";
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "db.localtest.me"].includes(host)) {
  console.error(`ローカルのDB以外（${host}）には書き込みません`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const H = 3600_000;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();

/**
 * 投稿済みの下書きを1つのバッチに作る。
 * @param items - 本文と、投稿からの時間
 * @returns 下書きのID
 */
async function published(items: { body: string; hours: number }[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    const b = await client.query(
      `INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
       VALUES ($1, gen_random_uuid(), $2, true) RETURNING id`,
      [accountId, chunk.length],
    );
    for (const [j, it] of chunk.entries()) {
      const r = await client.query(
        `INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at, published_at, threads_media_id, threads_permalink)
         VALUES ($1, $2, $3, $4, 'published', $5, $5, $6, $7) RETURNING id`,
        [accountId, b.rows[0].id, j, it.body, ago(it.hours), `seed_${Date.now()}_${i + j}`, `https://www.threads.com/@seed/post/${i + j}`],
      );
      ids.push(r.rows[0].id as string);
    }
  }
  return ids;
}

/**
 * 確定した反応数を入れる（judgment は後で metrics-runner と同じ規則で付ける）。
 * @param id - 下書きのID
 * @param views - 閲覧数
 * @param state - confirmed か late_confirmed
 * @param hours - 取り込み時の経過時間
 */
async function confirmed(id: string, views: number, state = "confirmed", hours = 168) {
  await client.query(
    `INSERT INTO post_metrics (draft_id, account_id, state, views, likes, replies, reposts, quotes, shares,
       last_fetched_at, last_elapsed_minutes, last_kind, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, now(), $6, $7, now())`,
    [id, accountId, state, views, Math.floor(views / 30), hours * 60, state === "confirmed" ? "d7" : "late"],
  );
}

try {
  if (countArg) {
    const n = Number(countArg);
    const ids = await published(Array.from({ length: n }, (_, i) => ({ body: `表示の速さの確認${i + 1}`, hours: 200 + i })));
    for (const [i, id] of ids.entries()) await confirmed(id, 10 + ((i * 37) % 200));
  } else {
    // 確定待ち（1時間前・24時間前・72時間前）、確定（168時間前）、遅れて確定（10日前）
    const [, h24, h72] = await published([
      { body: "1時間前の投稿", hours: 1 },
      { body: "24時間前の投稿", hours: 24 },
      { body: "72時間前の投稿", hours: 72 },
    ]);
    await client.query(
      `INSERT INTO post_metrics (draft_id, account_id, state, views, likes, last_fetched_at, last_elapsed_minutes, last_kind)
       VALUES ($1, $3, 'updating', 41, 1, now(), 1440, 'h24'), ($2, $3, 'updating', 66, 2, now(), 4320, 'd3')`,
      [h24, h72, accountId],
    );
    const [late] = await published([{ body: "10日前の投稿", hours: 240 }]);
    await confirmed(late!, 900, "late_confirmed", 240);
    // 確定した投稿15件（中央値52。好調2件・普通7件・低調6件）
    const views = [167, 260, 99, 64, 60, 58, 55, 52, 50, 8, 9, 10, 12, 13, 15];
    const ids = await published(views.map((v, i) => ({ body: `確定した投稿（閲覧 ${v}）`, hours: 170 + i })));
    for (const [i, id] of ids.entries()) await confirmed(id, views[i]!);
  }
  // metrics-runner と同じ規則で判定する（research.md R5）
  await client.query(
    `WITH base AS (
       SELECT pm.views FROM post_metrics pm JOIN post_drafts d ON d.id = pm.draft_id
       WHERE pm.account_id = $1 AND pm.state = 'confirmed' AND pm.views IS NOT NULL
       ORDER BY d.published_at DESC LIMIT 30
     ), b AS (SELECT count(*) n, percentile_cont(0.5) WITHIN GROUP (ORDER BY views) median FROM base)
     UPDATE post_metrics pm SET judgment = (CASE WHEN pm.views / b.median >= 2 THEN 'good'
         WHEN pm.views / b.median <= 0.5 THEN 'poor' ELSE 'normal' END)::judgment,
       judgment_ratio = pm.views / b.median, judgment_baseline = b.median, judged_at = now()
     FROM b WHERE pm.account_id = $1 AND pm.state IN ('confirmed','late_confirmed') AND pm.judgment IS NULL
       AND pm.views IS NOT NULL AND b.n >= 5 AND b.median > 0`,
    [accountId],
  );
  console.log(`Account ${accountId} に確認用のデータを作りました`);
} finally {
  await client.end();
}

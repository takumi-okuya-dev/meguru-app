// マイグレーションのテスト用の部品（specs/011-team-revision T004）。Node の上で動く（Workers の外）。
// 使い捨てのDBを作り、drizzle/ のマイグレーションを指定の番号まで当てる。drizzle の migrator と同じく、
// 1つのファイルを1つのトランザクションで当て、「--> statement-breakpoint」で文を分ける。
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadWorktreeEnv } from "../../scripts/worktree-env";

// 作業場所を分けているときは、その作業場所のDBの Postgres を使う（scripts/worktree-env.ts）
loadWorktreeEnv();
const DIRECT_URL = process.env.TEST_DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower";
// global-setup.ts と同じく pathname で読む（Workers の型と node:url の URL の型がぶつからないように）
const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url).pathname;

type Journal = { entries: { idx: number; tag: string }[] };

/** drizzle/meta/_journal.json のマイグレーションの一覧（番号の順）。 */
function journal(): { idx: number; tag: string }[] {
  const j = JSON.parse(readFileSync(`${DRIZZLE_DIR}meta/_journal.json`, "utf8")) as Journal;
  return [...j.entries].sort((a, b) => a.idx - b.idx);
}

/**
 * 使い捨てのDBを作る。
 * @returns DBにつながった pg.Client と、後片付けの関数
 */
export async function createScratchDb() {
  const name = `threads_grower_mig_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: DIRECT_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const url = new URL(DIRECT_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return {
    client,
    async drop() {
      await client.end();
      const a = new pg.Client({ connectionString: DIRECT_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await a.end();
    },
  };
}

/**
 * マイグレーションを、番号が from 以上 to 以下のものだけ当てる。
 * @param client - 当てるDB
 * @param from - 最初の番号（0始まり）
 * @param to - 最後の番号
 */
export async function applyMigrations(client: pg.Client, from: number, to: number) {
  for (const entry of journal().filter((e) => e.idx >= from && e.idx <= to)) {
    const sql = readFileSync(`${DRIZZLE_DIR}${entry.tag}.sql`, "utf8");
    await client.query("BEGIN");
    try {
      for (const stmt of sql.split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.query(stmt);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${entry.tag} failed: ${String(err)}`, { cause: err });
    }
  }
}

/**
 * マイグレーションの番号をタグから探す（例：0012_team_revision → 12）。
 * @param prefix - タグの先頭（"0012" など）
 * @returns 番号
 */
export function migrationIndex(prefix: string): number {
  const entry = journal().find((e) => e.tag.startsWith(prefix));
  if (!entry) throw new Error(`migration ${prefix} not found`);
  return entry.idx;
}

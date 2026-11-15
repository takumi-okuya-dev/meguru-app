// 手元で作業場所（git worktree）を分けて同時に進めるときの、作業場所ごとの値（docs/product-structure.md 6、README「手元で同時に進める」）。
// リポジトリのルートの .env.worktree（コミットしない。pnpm worktree:new が作る）に、DBの名前とポートのずらし幅を置く。
// ファイルがない作業場所（ふつうのクローン）では何もせず、今までどおり threads_grower と決まったポートを使う。
// マイグレーション（drizzle.config.ts）・結合テスト（test/global-setup.ts）・マイグレーションのテスト（test/helpers/migrate.ts）・
// 開発サーバー（scripts/dev.ts）が、ほかより先にこれを呼ぶ。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 作業場所ごとの値。 */
export type WorktreeEnv = {
  /** ローカルのDBの名前（既定は threads_grower） */
  dbName: string;
  /** 決まったポートに足す数（既定は 0） */
  portOffset: number;
};

/**
 * .env.worktree を読み、まだ環境変数にないDBの接続先（DATABASE_URL_DIRECT・TEST_DATABASE_URL・TEST_DATABASE_URL_DIRECT）を入れる。
 * すでに環境変数にあるものは上書きしない。
 * @returns 作業場所ごとの値
 */
export function loadWorktreeEnv(): WorktreeEnv {
  const values: Record<string, string> = {};
  try {
    // pathname は空白や日本語を %20 などのまま返すので、fileURLToPath でファイルのパスに直す
    const text = readFileSync(
      fileURLToPath(new URL("../../../.env.worktree", import.meta.url).href),
      "utf8",
    );
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) values[m[1]!] = m[2]!;
    }
  } catch {
    // ファイルがなければ、今までどおり
  }
  const dbName = values.MEGURU_DB_NAME || "threads_grower";
  const portOffset = Number(values.MEGURU_PORT_OFFSET || 0);
  if (!/^[a-z0-9_]+$/.test(dbName))
    throw new Error(`.env.worktree の MEGURU_DB_NAME が正しくありません：${dbName}`);
  if (!Number.isInteger(portOffset) || portOffset < 0) {
    throw new Error(
      `.env.worktree の MEGURU_PORT_OFFSET が正しくありません：${values.MEGURU_PORT_OFFSET}`,
    );
  }
  const direct = `postgres://postgres:postgres@localhost:5432/${dbName}`;
  process.env.DATABASE_URL_DIRECT ??= direct;
  process.env.TEST_DATABASE_URL_DIRECT ??= direct;
  // Workers からは local-neon-http-proxy 経由でつなぐ（接続先のURLのDBの名前どおりにつながる）
  process.env.TEST_DATABASE_URL ??= `postgres://postgres:postgres@db.localtest.me:5432/${dbName}`;
  return { dbName, portOffset };
}

// E2E とスクリプトが使う環境変数を、ローカルのファイルから読む（README「E2E」）。
// すでに環境変数にあるものは上書きしない。
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);

/**
 * KEY=VALUE の行のファイルを読み、まだない環境変数だけを入れる。ファイルがなければ何もしない。
 * @param path - リポジトリのルートからの場所
 * @param keys - 読む名前（省略するとすべて）
 */
export function loadEnvFile(path: string, keys?: string[]) {
  let text: string;
  try {
    text = readFileSync(new URL(path, ROOT), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || (keys && !keys.includes(m[1]!)) || process.env[m[1]!]) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

/**
 * 作業場所（git worktree）ごとのポートのずらし幅（リポジトリのルートの .env.worktree の MEGURU_PORT_OFFSET。
 * apps/api/scripts/worktree-env.ts）。ファイルがなければ 0。
 * @returns ずらし幅
 */
export function portOffset(): number {
  loadEnvFile(".env.worktree", ["MEGURU_PORT_OFFSET"]);
  const offset = Number(process.env.MEGURU_PORT_OFFSET ?? 0);
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error(`MEGURU_PORT_OFFSET が正しくありません：${process.env.MEGURU_PORT_OFFSET}`);
  return offset;
}

/**
 * 作業場所（git worktree）ごとのローカルのDBの名前（.env.worktree の MEGURU_DB_NAME）。ファイルがなければ threads_grower。
 * @returns DBの名前
 */
export function worktreeDbName(): string {
  loadEnvFile(".env.worktree", ["MEGURU_DB_NAME"]);
  const name = process.env.MEGURU_DB_NAME || "threads_grower";
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`MEGURU_DB_NAME が正しくありません：${name}`);
  return name;
}

/** Clerk のキー（apps/api/.dev.vars）と、ログインする人のメールアドレス（e2e/.env.local。E2E_CLERK_USER_EMAIL とチームの3人）を読む。 */
export function loadLocalEnv() {
  loadEnvFile("apps/api/.dev.vars", ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"]);
  loadEnvFile("e2e/.env.local");
}

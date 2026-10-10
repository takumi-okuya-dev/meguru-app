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

/** Clerk のキー（apps/api/.dev.vars）と、チーム運用の3人のメールアドレス（e2e/.env.local）を読む。 */
export function loadLocalEnv() {
  loadEnvFile("apps/api/.dev.vars", ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"]);
  loadEnvFile("e2e/.env.local");
}

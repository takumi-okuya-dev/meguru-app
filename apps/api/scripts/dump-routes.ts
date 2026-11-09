// APIの入口（メソッドとパス）の一覧を書き出す（specs/027-modular-monolith research.md R7）。
// 並べ替えの前後で一覧が変わらないことを確かめるために使う。使い方：pnpm --filter api exec tsx scripts/dump-routes.ts > 出力先
import { createApp } from "../src/app";

/**
 * Hono のアプリから、入口の一覧（「メソッド パス」の重複なし・並べたもの）を作る。
 * @param app - Hono のアプリ
 * @returns 1行に1つの入口
 */
export function routeLines(app: { routes: { method: string; path: string }[] }): string[] {
  return [...new Set(app.routes.map((r) => `${r.method} ${r.path}`))].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${routeLines(createApp()).join("\n")}\n`);
}

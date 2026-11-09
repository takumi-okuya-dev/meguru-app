// APIの入口（メソッドとパス）の一覧を書き出す（specs/027-modular-monolith research.md R7）。
// 一覧は test/repo/routes.snapshot.txt に置き、test/repo/routes-snapshot.test.ts で変わっていないことを確かめる。
// 入口を足す・変えたら `pnpm --filter api routes:snapshot` で書き直す（どこから流しても同じファイルに書く）。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp } from "../src/app";

/** 一覧を置くファイル。 */
export const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "../test/repo/routes.snapshot.txt");

type RouteTable = { routes: { method: string; path: string }[] };

/**
 * Hono のアプリから、入口の一覧を作る。
 * 前半は「メソッド パス ×件数」を並べたもの（入口ごとの関所（認証・運営者だけ・契約の確かめ）の数が変わると知らせる）。
 * 後半は、すべての入口にかかる関所（メソッドが ALL のもの）の、登録した順番（先に登録したものから効くため）。
 * @param app - Hono のアプリ
 * @returns 1行に1つの項目
 */
export function routeLines(app: RouteTable): string[] {
  const counts = new Map<string, number>();
  for (const r of app.routes) counts.set(`${r.method} ${r.path}`, (counts.get(`${r.method} ${r.path}`) ?? 0) + 1);
  const routes = [...counts.entries()].map(([k, n]) => `${k} ×${n}`).sort();
  const middlewareOrder = app.routes.filter((r) => r.method === "ALL").map((r, i) => `#${i + 1} ALL ${r.path}`);
  return ["# 入口と、それぞれの処理（関所を含む）の数", ...routes, "# すべての入口にかかる関所の順番", ...middlewareOrder];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(SNAPSHOT_PATH, `${routeLines(createApp()).join("\n")}\n`);
  process.stdout.write(`${SNAPSHOT_PATH} を書き直しました\n`);
}

// ファイルを移し、apps/api の src・test・scripts の相対の読みこみ先を機械的に直す（specs/027-modular-monolith tasks.md T008）。
// 使い方：pnpm --filter api exec tsx scripts/move-modules.ts <一覧のJSON>
//   一覧のJSON：[{ "from": "src/lib/errors.ts", "to": "src/kernel/errors.ts" }, …]（apps/api からの相対）
// 中身は変えず、読みこみ先の文字列だけを書き換える。移したあとは git mv で履歴をつなぐ。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** apps/api の絶対パス。 */
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 読みこみ先を書き換える対象のフォルダー。 */
const SCAN_DIRS = ["src", "test", "scripts"];

/** 移す1件。 */
export type Move = { from: string; to: string };

/**
 * フォルダーの中の .ts・.tsx をすべて集める。
 * @param dir - 絶対パス
 * @returns ファイルの絶対パス
 */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/**
 * 相対の読みこみ先を、実際のファイルの絶対パスに解く（.ts・.tsx・/index.ts を試す）。
 * @param fromFile - 読みこむファイルの絶対パス
 * @param spec - 読みこみ先の文字列
 * @param exists - ファイルがあるか
 * @returns ファイルの絶対パス（見つからなければ null）
 */
function resolveSpec(fromFile: string, spec: string, exists: (p: string) => boolean): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (exists(cand)) return cand;
  return null;
}

/**
 * 読みこみ先の文字列を作る（拡張子なし・/index は付けたままにしない元の書き方に合わせる）。
 * @param fromFile - 読みこむファイルの新しい絶対パス
 * @param target - 読みこみ先の新しい絶対パス
 * @param original - 元の文字列（/index で終わっていたかを見る）
 * @returns 新しい読みこみ先の文字列
 */
function specFor(fromFile: string, target: string, original: string): string {
  let t = target.replace(/\.(ts|tsx)$/, "");
  if (t.endsWith(`${sep}index`) && !/\/index$/.test(original)) t = t.slice(0, -`${sep}index`.length);
  let rel = relative(dirname(fromFile), t).split(sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** 読みこみ先の文字列を探す正規表現（from・import()・import "…"・vi.mock()・vi.importActual()・require()）。 */
const SPEC_RE = /((?:from|import)\s*\(?\s*|vi\.mock\(\s*|vi\.importActual\(\s*|require\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g;

/**
 * 移動と、読みこみ先の書き換えを行う。
 * @param moves - 移す一覧（apps/api からの相対）
 * @param opts - dryRun：書かずに数だけ返す
 * @returns 書き換えたファイルの数
 */
export function moveModules(moves: Move[], opts: { dryRun?: boolean } = {}): number {
  const moved = new Map(moves.map((m) => [resolve(API_ROOT, m.from), resolve(API_ROOT, m.to)]));
  for (const [from] of moved) if (!existsSync(from)) throw new Error(`ありません：${from}`);
  const files = SCAN_DIRS.flatMap((d) => walk(join(API_ROOT, d)));
  const exists = (p: string) => existsSync(p) && statSync(p).isFile();
  let changed = 0;
  const outputs = new Map<string, string>();
  for (const file of files) {
    const newFile = moved.get(file) ?? file;
    const src = readFileSync(file, "utf8");
    const out = src.replace(SPEC_RE, (all, head: string, q: string, spec: string) => {
      const target = resolveSpec(file, spec, exists);
      if (!target) return all;
      const newTarget = moved.get(target) ?? target;
      if (newTarget === target && newFile === file) return all;
      return `${head}${q}${specFor(newFile, newTarget, spec)}${q}`;
    });
    if (out !== src) changed += 1;
    outputs.set(file, out);
  }
  if (opts.dryRun) return changed;
  for (const [file, out] of outputs) writeFileSync(file, out);
  for (const [from, to] of moved) {
    execFileSync("mkdir", ["-p", dirname(to)]);
    execFileSync("git", ["mv", from, to], { cwd: API_ROOT });
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const list = JSON.parse(readFileSync(resolve(process.argv[2] ?? ""), "utf8")) as Move[];
  const n = moveModules(list);
  process.stdout.write(`${list.length}件を移し、${n}ファイルの読みこみ先を直しました\n`);
}

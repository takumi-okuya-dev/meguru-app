// デプロイのワークフローの検査（specs/015-deploy-environments、およびセキュリティ監査 run-1 の
// `deploy.yml:ref-to-environment-binding-only-enforced-inside-workflow-file`）。
//
// ここで守るのは3つ。
// 1. 出す先は ref の「完全な値」で決める。`github.ref_name` は短い名前で、ブランチとタグを
//    区別しない（`refs/tags/main` というタグの ref_name は `main` になる）。
// 2. ref の許可は、チェックアウトと `pnpm install` より前に終わらせる。`pnpm install` は
//    ワークスペースの lifecycle スクリプトを動かすので、許可より後ろに置くと意味がない。
// 3. `run:` の本文に `${{ }}` を埋め込まない。式はスクリプトを組み立てる時点で文字列として
//    入るので、`run:` の中に書いた検査では守れない。値は `env:` 経由で渡す。
//
// YAMLの依存を増やさないため、`wrangler-config.test.ts` と同じく生のテキストを読む。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// グローバルの URL は Workers の型なので、node:fs にはパスの文字列で渡す
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string): string => readFileSync(join(root, p), { encoding: "utf8" });
const deploy = read(".github/workflows/deploy.yml");
const ci = read(".github/workflows/ci.yml");

/**
 * コメント行（`#` だけの行）を落とす。「なぜ使わないか」の説明に名前が出てくるのは良いことなので、
 * 「使っていない」の検査はコメントを除いた本文に対して行う。
 * @param text - ワークフローの中身
 * @returns コメント行を落とした中身
 */
const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

/** 字下げの深さ（タブは使わない前提）。 */
const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * `run:` のブロックの本文をすべて取り出す。
 * @param text - ワークフローの中身
 * @returns 本文の並び（`run: |` の続きの行、または1行の `run:` の右側）
 */
function runBodies(text: string): string[] {
  const lines = text.split("\n");
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = line.match(/^(\s*)run:\s*(.*)$/);
    if (!m) continue;
    const head = (m[2] as string).trim();
    if (head !== "" && head !== "|" && head !== ">") {
      bodies.push(head);
      continue;
    }
    const depth = indentOf(line);
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] as string;
      if (next.trim() === "") {
        body.push(next);
        continue;
      }
      if (indentOf(next) <= depth) break;
      body.push(next);
    }
    bodies.push(body.join("\n"));
  }
  return bodies;
}

/**
 * ジョブごとの中身を取り出す（`jobs:` の直下の見出しで切る）。
 * @param text - ワークフローの中身
 * @returns ジョブの名前から中身への表
 */
function jobs(text: string): Map<string, string> {
  const lines = text.split("\n");
  const out = new Map<string, string>();
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return out;
  let name = "";
  let buf: string[] = [];
  let depth = -1;
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^(\s+)([A-Za-z0-9_-]+):\s*$/);
    if (m && (depth < 0 || indentOf(line) === depth)) {
      if (name) out.set(name, buf.join("\n"));
      depth = indentOf(line);
      name = m[2] as string;
      buf = [];
      continue;
    }
    if (name) buf.push(line);
  }
  if (name) out.set(name, buf.join("\n"));
  return out;
}

const deployJobs = jobs(deploy);

describe("deploy.yml の出す先の決め方", () => {
  it("`github.ref_name` を使っていない（タグとブランチを区別しないため）", () => {
    // `refs/tags/main` というタグは ref_name が `main` になり、本番側が選ばれてしまう
    expect(withoutComments(deploy)).not.toMatch(/github\.ref_name/);
  });

  it("ref の許可は完全な値で照合している", () => {
    expect(deploy).toMatch(/refs\/heads\/main/);
    expect(deploy).toMatch(/refs\/heads\/develop/);
  });

  it("許可を見るジョブが、Environmentを結び付けていない", () => {
    // Environmentを結び付けた時点で秘密がジョブに渡るので、許可の判定はその前の
    // 「Environmentを持たないジョブ」で終わらせる
    const guard = deployJobs.get("guard");
    expect(guard, "guard ジョブがない").toBeDefined();
    expect(guard).not.toMatch(/^\s*environment:/m);
  });

  it("許可を見るジョブが、リポジトリのコードを動かさない", () => {
    // チェックアウトも pnpm install もしない。ref の内容を実行する前に止めるため
    const guard = deployJobs.get("guard") ?? "";
    expect(guard).not.toMatch(/actions\/checkout/);
    expect(guard).not.toMatch(/pnpm install/);
  });

  it("デプロイのジョブは、許可を見るジョブの後にだけ動く", () => {
    const job = deployJobs.get("deploy") ?? "";
    expect(job).toMatch(/^\s*needs:\s*guard\s*$/m);
  });

  it("デプロイのジョブのEnvironmentは、許可を見るジョブの結果から決まる", () => {
    const job = deployJobs.get("deploy") ?? "";
    expect(job).toMatch(/^\s*environment:\s*\$\{\{\s*needs\.guard\.outputs\./m);
  });
});

describe("deploy.yml のシェルへの渡し方", () => {
  it("`run:` の本文に `${{ }}` を埋め込んでいない（値は env 経由で渡す）", () => {
    const bad = runBodies(deploy).filter((b) => /\$\{\{/.test(b));
    expect(bad, `run: の中に式が埋め込まれている:\n${bad.join("\n---\n")}`).toEqual([]);
  });
});

describe("ワークフローの権限", () => {
  it.each([
    ["deploy.yml", deploy],
    ["ci.yml", ci],
  ])("%s が GITHUB_TOKEN の範囲を明示している", (_name, text) => {
    // 既定に任せると、リポジトリやOrganizationの設定次第で広い権限が渡る
    expect(text).toMatch(/^permissions:/m);
  });
});

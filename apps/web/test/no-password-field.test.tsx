// パスワードの欄を作らない（specs/024-tester-invite-connect FR-001・SC-001、T063）。Threadsのパスワードを受け取る画面はどこにもない
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ディレクトリの下の .tsx・.ts を集める。
 * @param dir - ディレクトリ
 * @returns ファイルのパス
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

describe("パスワードの欄がない（SC-001）", () => {
  it("画面のどこにも type=password の入力欄がない", () => {
    const offenders = sources(join(__dirname, "../src")).filter((p) => /type=["']password["']|type:\s*["']password["']/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});

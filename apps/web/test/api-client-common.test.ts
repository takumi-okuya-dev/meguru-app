// 共通の部品（lib/api-client.ts・lib/query.ts）に、ThreadsのAPIの道筋とキーがないこと
// （specs/meguru/029-threads-pattern1 tasks.md T054、contracts/module-boundaries.md 5）。Threadsの分は apps/threads/lib/ に置く。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(join(webRoot, p), { encoding: "utf8" });

/** Threadsの道筋（新しい道筋と、PR5 で消す古い道筋）。 */
const THREADS_PATHS = [
  "/api/threads/",
  "/api/accounts",
  "/api/teams",
  "/api/invites/",
  "/api/me/needs-review-counts",
  "/api/operator/accounts",
  "/api/operator/tester-",
  "/api/data-deletion",
];

describe("共通の部品にThreadsがない", () => {
  it("lib/api-client.ts は、Threadsの道筋を呼ばない", () => {
    const src = read("src/lib/api-client.ts");
    // 呼び出しの道筋（文字列とテンプレート文字列）だけを見る
    const called = [...src.matchAll(/["`](\/api\/[^"`$?]*)/g)].map((m) => m[1]!);
    expect(called.length).toBeGreaterThan(0);
    expect(called.filter((p) => THREADS_PATHS.some((t) => p.startsWith(t)))).toEqual([]);
  });

  it("apps/threads/lib/api.ts は、新しい道筋（/api/threads/…）か、Metaに渡した道筋だけを呼ぶ", () => {
    const src = read("src/apps/threads/lib/api.ts");
    const called = [...src.matchAll(/["`](\/api\/[^"`$?]*)/g)].map((m) => m[1]!);
    expect(called.filter((p) => !p.startsWith("/api/threads/") && !p.startsWith("/api/data-deletion"))).toEqual([]);
  });

  it("lib/query.ts のキーに、Account・チーム・招待のキーがない", () => {
    const src = read("src/lib/query.ts");
    expect(src).not.toMatch(/\["(account|team|invite|operator-accounts|operator-tester-applications)"/);
  });
});

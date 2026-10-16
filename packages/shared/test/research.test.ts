// リサーチの手助け（specs/014-strategy-guidance FR-096・FR-098・FR-099、research.md R6）。
import { describe, expect, it } from "vitest";
import { freshnessOf, sortForPrompt } from "../src/research";

// 登録日時：2026-10-16 10:00 JST
const created = new Date("2026-10-16T01:00:00Z");
const post = (over: Partial<Parameters<typeof freshnessOf>[0]> = {}) => ({
  postedDateMode: "unknown" as const,
  postedDate: null,
  createdAt: created,
  ...over,
});

describe("freshnessOf（日本時間の日付で数える）", () => {
  const today = "2026-10-16";
  it.each([
    ["2026-10-16", "latest"],
    ["2026-09-16", "latest"], // 30日
    ["2026-09-15", "active"], // 31日
    ["2026-07-18", "active"], // 90日
    ["2026-07-17", "archive"], // 91日
  ] as const)("投稿日 %s は %s", (date, expected) => {
    expect(freshnessOf(post({ postedDateMode: "exact", postedDate: date }), today)).toBe(expected);
  });

  it("1週間以内・1か月以内・3か月以内は、登録日から7・30・90日前とみなす", () => {
    expect(freshnessOf(post({ postedDateMode: "week" }), today)).toBe("latest");
    expect(freshnessOf(post({ postedDateMode: "month" }), today)).toBe("latest");
    expect(freshnessOf(post({ postedDateMode: "3months" }), today)).toBe("active");
    // 登録から10日たつと、1か月以内（30日前とみなす）は40日前で現役
    expect(freshnessOf(post({ postedDateMode: "month" }), "2026-10-26")).toBe("active");
    // 登録から2日たつと、3か月以内（90日前とみなす）は92日前でアーカイブ
    expect(freshnessOf(post({ postedDateMode: "3months" }), "2026-10-18")).toBe("archive");
  });

  it("登録日は日本時間の日付で数える（UTCでは前の日でも）", () => {
    // 2026-10-16 08:00 JST = 2026-10-15 23:00 UTC
    const p = post({ postedDateMode: "month", createdAt: new Date("2026-10-15T23:00:00Z") });
    // 登録日（日本時間）10/16 の30日前＝9/16。10/16 から30日なので最新（UTCの10/15で数えると31日で現役になる）
    expect(freshnessOf(p, "2026-10-16")).toBe("latest");
  });

  it("不明は unknown", () => {
    expect(freshnessOf(post(), today)).toBe("unknown");
  });
});

describe("sortForPrompt（FR-099）", () => {
  it("最新 → 現役 → 投稿日不明 → アーカイブ、同じ区分は登録の新しい順", () => {
    const at = (iso: string) => new Date(iso);
    const posts = [
      { id: "archive", postedDateMode: "exact" as const, postedDate: "2026-01-01", createdAt: at("2026-10-16T00:00:00Z") },
      { id: "unknown-old", postedDateMode: "unknown" as const, postedDate: null, createdAt: at("2026-10-01T00:00:00Z") },
      { id: "latest-old", postedDateMode: "exact" as const, postedDate: "2026-10-10", createdAt: at("2026-10-02T00:00:00Z") },
      { id: "active", postedDateMode: "exact" as const, postedDate: "2026-08-01", createdAt: at("2026-10-15T00:00:00Z") },
      { id: "latest-new", postedDateMode: "week" as const, postedDate: null, createdAt: at("2026-10-14T00:00:00Z") },
      { id: "unknown-new", postedDateMode: "unknown" as const, postedDate: null, createdAt: at("2026-10-12T00:00:00Z") },
    ];
    expect(sortForPrompt(posts, "2026-10-16").map((p) => p.id)).toEqual([
      "latest-new",
      "latest-old",
      "active",
      "unknown-new",
      "unknown-old",
      "archive",
    ]);
  });
});

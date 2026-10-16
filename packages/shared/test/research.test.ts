// リサーチの手助け（specs/014-strategy-guidance FR-096・FR-098・FR-099、research.md R6）。
import { describe, expect, it } from "vitest";
import { buildExplainPrompt, freshnessOf, parseExplanations, shortIdsOf, sortForPrompt } from "../src/research";
import { emptyStrategyValues } from "../src/strategy";

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

describe("shortIdsOf（FR-102）", () => {
  it("「-」を除いた先頭8文字。重なるIDだけ、重ならない長さまで延ばす", () => {
    const ids = [
      "8f363364-c8e3-490e-93cc-deb8b67e3f4a",
      "8f363364-c9aa-490e-93cc-deb8b67e3f4a",
      "12345678-0000-4000-8000-000000000000",
    ];
    const m = shortIdsOf(ids);
    expect(m.get(ids[0]!)).toBe("8f363364c8");
    expect(m.get(ids[1]!)).toBe("8f363364c9");
    expect(m.get(ids[2]!)).toBe("12345678");
  });
});

describe("buildExplainPrompt（FR-086・FR-101、contracts/prompt-template.md 5）", () => {
  const post = {
    id: "8f363364-c8e3-490e-93cc-deb8b67e3f4a",
    shortId: "8f363364",
    body: "大人の友達って、\nどこで作ってる？",
    keyword: "社会人 友達",
    postUrl: "",
    platform: "threads" as const,
    postedDateMode: "week" as const,
    postedDate: null,
    metrics: { likes: 820, replies: null, views: 32000, saves: null, reposts: null, followers: null },
    author: "",
    memo: "冒頭が気になった",
  };
  const strategy = { ...emptyStrategyValues(), targetPersona: "28歳前後の会社員", purposeOrigin: "上京して寂しかった" };

  it("1件：本文・分かっている数字（ほかは不明）・課題・解説の形が入り、【ID】と区切りはない", () => {
    const p = buildExplainPrompt([post], strategy, { batch: false });
    expect(p).toContain("本文:\n大人の友達って、\nどこで作ってる？");
    expect(p).toContain("閲覧数: 32000");
    expect(p).toContain("コメント: 不明");
    expect(p).toContain("元の投稿の投稿日: 1週間以内");
    expect(p).toContain("登録者のメモ: 冒頭が気になった");
    expect(p).toContain("- 届けたい人: 28歳前後の会社員");
    expect(p).toContain("- 活動を始めたきっかけ: 上京して寂しかった");
    expect(p).toContain("【型の名前】");
    expect(p).toContain("800字程度");
    expect(p).not.toContain("【ID:");
    expect(p).not.toContain("@@@");
  });

  it("まとめて：投稿ごとに【ID】と @@@ の区切り、1件400〜600字", () => {
    const p = buildExplainPrompt([post, { ...post, id: "x", shortId: "12345678", body: "2件目" }], strategy, { batch: true });
    expect(p).toContain("【ID:8f363364】");
    expect(p).toContain("【ID:12345678】");
    expect(p).toContain("2件分析し");
    expect(p).toContain("400〜600字");
    expect(p).toContain("「@@@」だけの行で区切る");
  });
});

describe("parseExplanations（FR-103）", () => {
  const posts = [
    { id: "id-a", shortId: "aaaaaaaa", whyGood: "" },
    { id: "id-b", shortId: "bbbbbbbb", whyGood: "  " },
    { id: "id-c", shortId: "cccccccc", whyGood: "解説あり" },
  ];

  it("@@@ で分け、【ID】で結び付け、【ID】の行を除いた残りを解説にする（全角の：も可）", () => {
    const text = "【ID:aaaaaaaa】\n【型の名前】あるある型\n@@@\n【ID：bbbbbbbb】\n【型の名前】告白型";
    const r = parseExplanations(text, posts);
    expect(r).toEqual([
      { id: "id-a", shortId: "aaaaaaaa", text: "【型の名前】あるある型", problem: null },
      { id: "id-b", shortId: "bbbbbbbb", text: "【型の名前】告白型", problem: null },
    ]);
  });

  it("見つからない・すでに解説がある・2回目・空・長すぎるブロックに理由を付ける", () => {
    const text = [
      "前置きの説明です",
      "【ID:zzzzzzzz】\n解説",
      "【ID:cccccccc】\n解説",
      "【ID:aaaaaaaa】\n1回目",
      "【ID:aaaaaaaa】\n2回目",
      "【ID:bbbbbbbb】\n  ",
    ].join("\n@@@\n");
    const r = parseExplanations(text, posts);
    expect(r.map((x) => x.problem)).toEqual(["not_found", "not_found", "already_explained", null, "duplicate", "empty"]);
    const long = parseExplanations(`【ID:aaaaaaaa】\n${"あ".repeat(2001)}`, posts);
    expect(long[0]!.problem).toBe("too_long");
  });
});

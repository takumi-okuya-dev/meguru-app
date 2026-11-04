// 区切りと傾向（specs/022-algorithm-analysis research.md R4・R5・R11、T012）。
import { describe, expect, it } from "vitest";
import { POST_LENGTH_DEFAULTS, analyzePosts, type AnalysisPost } from "../../src";
import { jst, makePosts, post } from "./fixtures";

const opts = { lengthSettings: POST_LENGTH_DEFAULTS, themes: [] };

describe("analyzePosts（区切り）", () => {
  it("時間帯・曜日・文字数・本文の特徴ごとに件数と中央値が並ぶ", () => {
    const r = analyzePosts(makePosts(60), opts);
    expect(r.needMore).toBeNull();
    expect(r.time.map((b) => b.key)).toEqual(["morning", "noon", "evening", "night", "latenight"]);
    const night = r.time.find((b) => b.key === "night")!;
    expect(night.count).toBe(15);
    expect(night.views).toBe(420);
    expect(night.mark).toBeNull();
    expect(r.time.find((b) => b.key === "morning")!.views).toBe(220);
    expect(r.time.find((b) => b.key === "latenight")).toMatchObject({ count: 0, views: null, engagementRate: null, mark: "untried" });
    expect(r.day.map((b) => b.label)).toEqual(["平日", "休日"]);
    expect(r.day.reduce((a, b) => a + b.count, 0)).toBe(60);
    expect(r.length.map((b) => b.key)).toEqual(["short", "medium", "long"]);
    expect(r.features.map((f) => f.key)).toEqual(["question", "number", "shortFirstLine", "manyLines", "emoji", "callout"]);
    expect(r.totals).toEqual({ confirmed: 60, promo: 0, withFollowers: 60, classified: 0 });
  });

  it("10件未満の区切りは「件数が少ない」", () => {
    const posts = makePosts(30, (i) => (i < 3 ? { publishedAt: jst("2026-08-03", 2) } : {}));
    expect(analyzePosts(posts, opts).time.find((b) => b.key === "latenight")).toMatchObject({ count: 3, mark: "few" });
  });

  it("確定した投稿が20件未満なら、あと何件かを出して表と傾向は空", () => {
    const r = analyzePosts(makePosts(12), opts);
    expect(r.needMore).toBe(8);
    expect(r.trends).toEqual([]);
    expect(r.time).toEqual([]);
    expect(r.recommended).toEqual({ available: false, posts: [], compare: null });
    expect(r.totals.confirmed).toBe(12);
  });
});

describe("analyzePosts（傾向）", () => {
  it("夜の閲覧が高いと、夜の傾向が件数と中央値つきで出る", () => {
    const t = analyzePosts(makePosts(60), opts).trends.find((x) => x.dimension === "time")!;
    expect(t).toMatchObject({ key: "night", text: "夜（20〜23時）に出した投稿が伸びやすい", count: 15, views: 420, otherCount: 45, otherViews: 220, promptable: false });
    expect(t.ratio).toBeCloseTo(420 / 220);
  });

  it("差が1.5倍に届かない・片側が10件未満なら傾向にしない（SC-002）", () => {
    const flat = makePosts(60, () => ({ views: 300 }));
    expect(analyzePosts(flat, opts).trends).toEqual([]);
    // 夜の投稿が9件だけ（ほかの時間帯に移す）
    const few = makePosts(60, (i) => (i % 4 === 3 && i > 35 ? { publishedAt: jst("2026-08-03", 12), views: 200 } : {}));
    const r = analyzePosts(few, opts);
    expect(r.time.find((b) => b.key === "night")!.count).toBe(9);
    expect(r.trends.filter((x) => x.dimension === "time")).toEqual([]);
  });

  it("ほかの投稿の中央値が0なら傾向にしない", () => {
    const posts = makePosts(40, (i) => ({ views: i % 4 === 3 ? 100 : 0 }));
    expect(analyzePosts(posts, opts).trends.filter((x) => x.dimension === "time")).toEqual([]);
  });

  it("区切りの種類ごとに1つ、倍率の大きい順に5つまで", () => {
    // 夜（i % 4 === 3）は800、最後に問いかけ（i % 4 === 1）は600、ほかは200
    const posts: AnalysisPost[] = makePosts(80, (i) => {
      const q = i % 4 === 1;
      return {
        body: `${i % 3 === 0 ? "😊" : ""}${q ? "みんなはどう？" : "こうしてる"}`,
        views: i % 4 === 3 ? 800 : q ? 600 : 200,
      };
    });
    const r = analyzePosts(posts, opts);
    expect(r.trends.length).toBeLessThanOrEqual(5);
    expect(r.trends.filter((t) => t.dimension === "time").length).toBe(1);
    const ratios = r.trends.map((t) => t.ratio);
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios);
    expect(r.trends.find((t) => t.key === "question")?.text).toBe("最後に問いかけがある投稿が伸びやすい");
  });

  it("「なし」の側が伸びた本文の特徴も傾向にする", () => {
    const posts = makePosts(40, (i) => (i % 2 === 0 ? { body: "うれしい😊", views: 100 } : { body: "うれしい", views: 300 }));
    const t = analyzePosts(posts, opts).trends.find((x) => x.key === "emoji")!;
    expect(t.text).toBe("絵文字のない投稿が伸びやすい");
    expect(t.promptable).toBe(true);
  });

  it("文字数の傾向の文に字数の幅が入る", () => {
    const posts = makePosts(40, (i) => (i % 2 === 0 ? { body: "あ".repeat(100), views: 500 } : { body: "あ".repeat(30), views: 200 }));
    expect(analyzePosts(posts, opts).trends.find((x) => x.dimension === "length")?.text).toBe("中くらい（78〜117字）の投稿が伸びやすい");
  });

  it("宣伝の投稿の数を数える", () => {
    const posts = makePosts(30, (i) => ({ promo: i < 4 }));
    expect(analyzePosts(posts, opts).totals.promo).toBe(4);
  });
});

describe("analyzePosts（おすすめに乗った目安。T020）", () => {
  it("広がりの上位20%で1を超える投稿を、広がりの大きい順に並べる", () => {
    const posts = makePosts(30, (i) => ({ views: 50 + i * 10, followersAtPost: 100, body: `${"あ".repeat(45)}${i}` }));
    const r = analyzePosts(posts, opts).recommended;
    expect(r.available).toBe(true);
    expect(r.posts.map((p) => p.id)).toEqual(["p29", "p28", "p27", "p26", "p25", "p24"]);
    expect(r.posts[0]).toMatchObject({ views: 340, spread: 3.4, head: "あ".repeat(40) });
    expect(r.compare!.recommended.count).toBe(6);
    expect(r.compare!.others.count).toBe(24);
  });

  it("広がりが1以下なら上位でも入れない。フォロワー数のない投稿は外す", () => {
    const low = makePosts(30, (i) => ({ views: 10 + i, followersAtPost: 100 }));
    expect(analyzePosts(low, opts).recommended.posts).toEqual([]);
    expect(analyzePosts(low, opts).recommended.compare).toBeNull();
    const mixed = makePosts(30, (i) => ({ views: 50 + i * 10, followersAtPost: i >= 25 ? null : 100 }));
    const r = analyzePosts(mixed, opts);
    expect(r.totals.withFollowers).toBe(25);
    expect(r.recommended.posts.every((p) => !["p25", "p26", "p27", "p28", "p29"].includes(p.id))).toBe(true);
  });

  it("広がりを求められる投稿が10件未満なら出さない", () => {
    const posts = makePosts(30, (i) => ({ followersAtPost: i < 9 ? 100 : null }));
    expect(analyzePosts(posts, opts).recommended).toEqual({ available: false, posts: [], compare: null });
  });

  it("ほかの投稿との比べ：初速・後からの伸び・返信率・文字数・問いかけの件数", () => {
    const posts = makePosts(20, (i) => {
      const top = i >= 16;
      return {
        views: top ? 500 : 100,
        followersAtPost: 100,
        h24Views: top ? 250 : 80,
        replies: top ? 10 : 1,
        body: top ? "どう思う？" : "こうでした",
      };
    });
    const c = analyzePosts(posts, opts).recommended.compare!;
    expect(c.recommended).toMatchObject({ count: 4, firstSpeed: 250, laterGrowth: 2, replyRate: 0.02, length: 5, questionCount: 4 });
    expect(c.others).toMatchObject({ count: 16, firstSpeed: 80, laterGrowth: 1.25, replyRate: 0.01, questionCount: 0 });
  });
});

describe("analyzePosts の入力", () => {
  it("1件だけ確かめる用の post() も使える", () => {
    expect(analyzePosts([post()], opts).needMore).toBe(19);
  });
});

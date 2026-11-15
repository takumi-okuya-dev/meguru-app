// プロンプトに入れる傾向の守り（specs/022-algorithm-analysis research.md R7、T026）。
import { describe, expect, it } from "vitest";
import { trendsForPrompt, type Trend } from "../../src";

const trend = (over: Partial<Trend>): Trend => ({
  dimension: "feature",
  key: "question",
  text: "最後に問いかけがある投稿が伸びやすい",
  count: 20,
  views: 480,
  otherCount: 44,
  otherViews: 250,
  ratio: 1.92,
  promptable: true,
  ...over,
});

describe("trendsForPrompt", () => {
  it("時間帯・曜日の傾向は入れない", () => {
    const out = trendsForPrompt(
      [trend({ dimension: "time", key: "night", promptable: false }), trend({ dimension: "day", key: "holiday", promptable: false }), trend({})],
      [],
      [],
    );
    expect(out.map((t) => t.dimension)).toEqual(["feature"]);
  });

  it("CORE RULESに出てくる特徴の傾向は、向きに関係なく入れない（SC-003）", () => {
    const trends = [
      trend({ key: "emoji", text: "絵文字を入れた投稿が伸びやすい" }),
      trend({ key: "question" }),
      trend({ key: "number", text: "数字を入れた投稿が伸びやすい" }),
      trend({ key: "callout", text: "呼びかけ（あなた・みんな）がある投稿が伸びやすい" }),
      trend({ key: "manyLines", text: "改行が多い（5行以上）投稿が伸びやすい" }),
      trend({ key: "shortFirstLine", text: "1行目が20字以内の投稿が伸びやすい" }),
    ];
    expect(trendsForPrompt(trends, ["絵文字は使わない"], []).map((t) => t.key)).not.toContain("emoji");
    expect(trendsForPrompt(trends, ["読者に質問しない"], []).map((t) => t.key)).not.toContain("question");
    expect(trendsForPrompt(trends, ["数字は半角で書く"], []).map((t) => t.key)).not.toContain("number");
    expect(trendsForPrompt(trends, ["呼びかけない"], []).map((t) => t.key)).not.toContain("callout");
    expect(trendsForPrompt(trends, ["改行は2行まで"], []).map((t) => t.key)).not.toContain("manyLines");
    expect(trendsForPrompt(trends, ["書き出しは結論から"], []).map((t) => t.key)).not.toContain("shortFirstLine");
    expect(trendsForPrompt(trends, ["敬語で書く"], []).length).toBe(5);
  });

  it("NGワードを含む傾向は入れない", () => {
    const out = trendsForPrompt(
      [trend({ dimension: "theme", key: "t1", text: "テーマ「副業で稼ぐ」の投稿が伸びやすい" }), trend({})],
      [],
      ["稼ぐ"],
    );
    expect(out.map((t) => t.key)).toEqual(["question"]);
  });

  it("5つまで", () => {
    const many = Array.from({ length: 8 }, (_, i) => trend({ dimension: "theme", key: `t${i}`, text: `テーマ「${i}」の投稿が伸びやすい` }));
    expect(trendsForPrompt(many, [], []).length).toBe(5);
  });
});

// 内容の分類のプロンプトと答えの読み取り（specs/022-algorithm-analysis contracts/analysis.md、research.md R8、T034）。
import { describe, expect, it } from "vitest";
import { POST_LENGTH_DEFAULTS, analyzePosts, classifyPrompt, parseClassifyAnswer } from "../../src";
import { makePosts } from "./fixtures";

const themes = [
  { id: "t1", name: "仕事の悩み" },
  { id: "t2", name: "転職" },
];
const posts = [
  { draftId: "d1", body: "会社員3年目で気づいたこと" },
  { draftId: "d2", body: "転職して変わったのは\n給料じゃなかった" },
  { draftId: "d3", body: "職場で話しかけやすい人って？" },
];

describe("classifyPrompt", () => {
  it("型の7つ・テーマ・答えの形・番号つきの本文が入る", () => {
    const p = classifyPrompt(posts, themes);
    expect(p).toContain("あるある／問いかけ／言い切り／体験談／数字／告知／その他");
    expect(p).toContain("仕事の悩み／転職");
    expect(p).toContain("【1】書き出しの型：あるある／テーマ：仕事の悩み");
    expect(p).toContain("【2】\n転職して変わったのは\n給料じゃなかった");
    expect(p).toContain("【3】\n職場で話しかけやすい人って？");
  });

  it("テーマがないときは型だけを答えてもらう", () => {
    const p = classifyPrompt(posts, []);
    expect(p).toContain("# テーマ\nなし(テーマは付けない)");
    expect(p).toContain("【1】書き出しの型：あるある\n");
    expect(p).not.toContain("テーマ：");
  });
});

describe("parseClassifyAnswer", () => {
  it("目印の行だけを読み、前後の文は無視する", () => {
    const text = "分類しました！\n【1】書き出しの型：体験談／テーマ：仕事の悩み\n【2】書き出しの型: 体験談 / テーマ: 転職\n【3】書き出しの型：問いかけ、テーマ：なし\n以上です";
    const r = parseClassifyAnswer(text, posts, themes);
    expect(r.items).toEqual([
      { index: 1, draftId: "d1", openingType: "story", themeId: "t1" },
      { index: 2, draftId: "d2", openingType: "story", themeId: "t2" },
      { index: 3, draftId: "d3", openingType: "question", themeId: null },
    ]);
    expect(r.problems).toEqual([]);
  });

  it("「」『』と全角・半角のちがいを無視し、同じ番号は後のほう", () => {
    const text = "【１】書き出しの型：「あるある」／テーマ：『転職』\n【1】書き出しの型：言い切り／テーマ：転職";
    const r = parseClassifyAnswer(text, posts, themes);
    expect(r.items).toEqual([{ index: 1, draftId: "d1", openingType: "assertion", themeId: "t2" }]);
  });

  it("知らない型・知らないテーマ・範囲外の番号・答えのない投稿は problems に理由つき", () => {
    const text = "【1】書き出しの型：ジョーク／テーマ：転職\n【2】書き出しの型：体験談／テーマ：雑談\n【9】書き出しの型：体験談／テーマ：転職";
    const r = parseClassifyAnswer(text, posts, themes);
    expect(r.items).toEqual([]);
    expect(r.problems).toEqual([
      { index: 1, reason: "知らない書き出しの型「ジョーク」" },
      { index: 2, reason: "知らないテーマ「雑談」" },
      { index: 3, reason: "答えがない" },
    ]);
  });

  it("テーマがないときは型だけで付ける", () => {
    const r = parseClassifyAnswer("【1】書き出しの型：あるある", posts.slice(0, 1), []);
    expect(r.items).toEqual([{ index: 1, draftId: "d1", openingType: "aruaru", themeId: null }]);
  });
});

describe("analyzePosts（書き出しの型・テーマ）", () => {
  it("分類の付いた投稿だけで表と傾向を求める。一覧にないテーマはテーマなし", () => {
    const list = makePosts(60, (i) =>
      i < 40
        ? { openingType: i % 2 === 0 ? "aruaru" : "story", themeId: i % 2 === 0 ? "t2" : i % 3 === 0 ? "t9" : "t1", views: i % 2 === 0 ? 600 : 200 }
        : {},
    );
    const r = analyzePosts(list, { lengthSettings: POST_LENGTH_DEFAULTS, themes });
    expect(r.totals.classified).toBe(40);
    expect(r.opening.find((b) => b.key === "aruaru")).toMatchObject({ count: 20, views: 600 });
    expect(r.opening.find((b) => b.key === "other")).toMatchObject({ count: 0, mark: "untried" });
    expect(r.theme.map((b) => b.label)).toEqual(["仕事の悩み", "転職"]);
    expect(r.theme.find((b) => b.key === "t2")!.count).toBe(20);
    expect(r.trends.find((t) => t.dimension === "opening")?.text).toBe("「あるある」の書き出しが伸びやすい");
    expect(r.trends.find((t) => t.dimension === "theme")?.text).toBe("テーマ「転職」の投稿が伸びやすい");
  });
});

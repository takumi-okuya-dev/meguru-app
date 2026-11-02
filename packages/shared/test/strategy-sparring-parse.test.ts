// AIと壁打ちして課題を埋める：答えの読み取り（specs/018-strategy-ai-sparring FR-010〜FR-014、contracts/prompt-template.md 2、research.md R3）。
import { describe, expect, it } from "vitest";
import { SPARRING_ITEM_END, parseSparringAnswer } from "../src/strategy-sparring";

const END = SPARRING_ITEM_END;

describe("parseSparringAnswer", () => {
  it("決まった形の答えを、項目ごとに読み取る。目印の外の文は使わない", () => {
    const text = [
      "質問へのお答え、ありがとうございました。完成版です。",
      "",
      "【項目：ターゲットの本音の悩み】",
      "お金が残らない。",
      "家計簿は続かない。",
      END,
      "",
      "【項目：活動の軸】",
      "ひとりにしない",
      END,
      "",
      "ほかに直したい項目があれば教えてください。",
    ].join("\n");
    expect(parseSparringAnswer(text)).toEqual({
      items: [
        { key: "activityAxis", text: "ひとりにしない" },
        { key: "realWorries", text: "お金が残らない。\n家計簿は続かない。" },
      ],
      unknown: [],
      markerFound: true,
    });
  });

  it("太字・コード・見出しで囲んだ目印も読み取る", () => {
    const text = [
      "**【項目：ターゲットの本音の悩み】**",
      "A",
      `**${END}**`,
      "`【項目：活動の軸】`",
      "B",
      `\`${END}\``,
      "## 【項目：来てほしくない人】",
      "C",
      `## ${END}`,
    ].join("\n");
    expect(parseSparringAnswer(text).items).toEqual([
      { key: "activityAxis", text: "B" },
      { key: "realWorries", text: "A" },
      { key: "antiPersona", text: "C" },
    ]);
  });

  it("半角の「:」・空白・括弧の違い、括弧の中を省いた名前、「Q1」だけでも同じ項目にする", () => {
    const text = [
      "【項目: ターゲットの 本音の悩み】",
      "A",
      END,
      "【項目：「来てほしくない人」】",
      "B",
      END,
      "【項目：投稿ジャンル】",
      "C",
      END,
      "【項目：Q1】",
      "D",
      END,
      "【項目：Q5：活動するうえで、どんな在り方を大切にしたいですか?】",
      "E",
      END,
    ].join("\n");
    expect(parseSparringAnswer(text).items).toEqual([
      { key: "purposeOrigin", text: "D" },
      { key: "purposeStance", text: "E" },
      { key: "realWorries", text: "A" },
      { key: "antiPersona", text: "B" },
      { key: "postGenres", text: "C" },
    ]);
  });

  it("終わりの目印がなければ次の始まりまで、最後の項目は答えの終わりまで", () => {
    const text = ["【項目：ターゲットの本音の悩み】", "A", "【項目：来てほしくない人】", "B", "", "以上です"].join("\n");
    expect(parseSparringAnswer(text).items).toEqual([
      { key: "realWorries", text: "A" },
      { key: "antiPersona", text: "B\n\n以上です" },
    ]);
  });

  it("同じ項目が2回あれば後のもの。中身が空の項目は入れない", () => {
    const text = [
      "【項目：活動の軸】",
      "1つ目",
      END,
      "【項目：活動の軸】",
      "2つ目",
      END,
      "【項目：来てほしくない人】",
      "   ",
      END,
    ].join("\n");
    expect(parseSparringAnswer(text).items).toEqual([{ key: "activityAxis", text: "2つ目" }]);
  });

  it("対象ではない名前は読み取れなかった項目にする（重ねず、出てきた順）", () => {
    const text = [
      "【項目：近い人間性】",
      "丁寧・温かい",
      END,
      "【項目：好きな食べ物】",
      "カレー",
      END,
      "【項目：近い人間性】",
      "情熱的",
      END,
      "【項目：プロフィール文】",
      "下書き",
      END,
    ].join("\n");
    expect(parseSparringAnswer(text)).toEqual({
      items: [],
      unknown: ["近い人間性", "好きな食べ物", "プロフィール文"],
      markerFound: true,
    });
  });

  it("目印が1つもなければ markerFound が false", () => {
    expect(parseSparringAnswer("## ターゲットの本音の悩み\nお金が残らない")).toEqual({
      items: [],
      unknown: [],
      markerFound: false,
    });
  });

  it("】のあとの同じ行の文は、中身の1行目にする", () => {
    const text = ["【項目：活動の軸】ひとりにしない", "（20文字前後）", END].join("\n");
    expect(parseSparringAnswer(text).items).toEqual([{ key: "activityAxis", text: "ひとりにしない\n（20文字前後）" }]);
  });

  it("答え全体を囲むコードブロックの行は、中身に入れない", () => {
    const text = ["```", "【項目：活動の軸】", "ひとりにしない", "```"].join("\n");
    expect(parseSparringAnswer(text).items).toEqual([{ key: "activityAxis", text: "ひとりにしない" }]);
  });
});

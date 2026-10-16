// 課題のAIのプロンプト（specs/014-strategy-guidance FR-032・FR-033・FR-036・FR-037・FR-041、contracts/prompt-template.md 2〜4）。
import { describe, expect, it } from "vitest";
import { emptyStrategyValues } from "../src/strategy";
import {
  FINAL_BEGIN,
  FINAL_END,
  buildDeepenPrompt,
  extractFinal,
} from "../src/strategy-prompts";

describe("buildDeepenPrompt", () => {
  it("項目名・説明・ヒント・今の入力・頼み方・目印の2行が入る", () => {
    const v = emptyStrategyValues();
    v.targetPersona = "20代会社員";
    const p = buildDeepenPrompt("targetPersona", v);
    expect(p).toContain("「どんな人に投稿を届けたいか」");
    expect(p).toContain("年齢や職業だけでなく、今どんな状況にいる人か");
    expect(p).toContain("コツ: 年齢・職業で終わらせず");
    expect(p).toContain("悪い例: 20代会社員");
    expect(p).toContain("足してみたい観点: 平日の終わり方と、休日の過ごし方・よく見ているSNSやアカウント・お金と時間の余裕");
    expect(p).toContain("■今の私の答え\n20代会社員");
    expect(p).toContain("一度に1〜2問ずつ質問してください");
    expect(p).toContain(`${FINAL_BEGIN}\n(完成版)\n${FINAL_END}`);
  });

  it("今の入力が空なら「未入力」", () => {
    expect(buildDeepenPrompt("finalAction", emptyStrategyValues())).toContain("■今の私の答え\n未入力");
  });

  it("ほかの項目は入力のあるものだけを文脈に入れ、下書きとこの項目は入れない", () => {
    const v = emptyStrategyValues();
    v.finalAction = "公式LINEに登録";
    v.purposeOrigin = "上京して寂しかった";
    v.activityAxis = "ひとりにしない";
    v.tonePreset = "polite_warm";
    v.profileBioDraft = "プロフィールの下書き";
    v.realWorries = "今の答え";
    const p = buildDeepenPrompt("realWorries", v);
    expect(p).toContain("- 最終的に読者に取ってほしい行動: 公式LINEに登録");
    expect(p).toContain("- Q1：なぜ、この活動を始めようと思いましたか？: 上京して寂しかった");
    expect(p).toContain("- 活動の軸: ひとりにしない");
    expect(p).toContain("- 近い人間性: 丁寧・温かい");
    expect(p).not.toContain("プロフィールの下書き");
    expect(p).not.toContain("- ターゲットの本音の悩み:");
  });

  it("ほかに入力がなければ、文脈の節を入れない", () => {
    expect(buildDeepenPrompt("finalAction", emptyStrategyValues())).not.toContain("■ほかの項目に書いたこと");
  });

  it("発信テーマの掛け合わせは、候補を3つ以上出して相談する頼み方にする（FR-037）", () => {
    const p = buildDeepenPrompt("contentThemeMix", emptyStrategyValues());
    expect(p).toContain("掛け合わせの候補を3つ以上出し");
    expect(p).toContain("相談して1つに決めてから");
  });
});

describe("extractFinal（FR-033）", () => {
  it("目印の組の内側を、前後の空白を除いて返す", () => {
    const text = `ありがとうございます。\n\n${FINAL_BEGIN}\n  完成した文  \n${FINAL_END}\n\n直したいところは？`;
    expect(extractFinal(text)).toEqual({ text: "完成した文", marked: true });
  });

  it("組がなければ全体を返す", () => {
    expect(extractFinal("  そのままの文 \n")).toEqual({ text: "そのままの文", marked: false });
  });

  it("2組あれば最初の組", () => {
    const text = `${FINAL_BEGIN}\n1つ目\n${FINAL_END}\n${FINAL_BEGIN}\n2つ目\n${FINAL_END}`;
    expect(extractFinal(text).text).toBe("1つ目");
  });

  it("始まりだけなら、組がないものとして全体を返す", () => {
    const text = `${FINAL_BEGIN}\n途中まで`;
    expect(extractFinal(text)).toEqual({ text, marked: false });
  });
});

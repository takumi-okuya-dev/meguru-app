// 課題のAIのプロンプト（specs/014-strategy-guidance FR-032・FR-033・FR-036・FR-037・FR-041、contracts/prompt-template.md 2〜4）。
import { describe, expect, it } from "vitest";
import { emptyStrategyValues } from "../src/strategy";
import {
  FINAL_BEGIN,
  FINAL_END,
  buildAxisPrompt,
  buildDeepenPrompt,
  buildOverallPrompt,
  buildSparringPrompt,
  extractFinal,
} from "../src/strategy-prompts";
import { SPARRING_ITEM_END, SPARRING_KEYS } from "../src/strategy-sparring";

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

describe("buildOverallPrompt（FR-041）", () => {
  it("区分の順に全項目（下書きを除く）を並べ、空は「未入力」、頼み方は質問だけ", () => {
    const v = emptyStrategyValues();
    v.purposeOrigin = "上京して寂しかった";
    v.targetPersona = "28歳前後の会社員";
    v.tonePreset = "formal";
    v.profileBioDraft = "プロフィールの下書き";
    const p = buildOverallPrompt(v);
    const order = ["■活動の目的・在り方", "■営業導線設計", "■アカウント設計", "■集客導線設計", "■人柄（トンマナ）", "■その他"];
    const positions = order.map((h) => p.indexOf(h));
    expect(positions.every((x) => x >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(p).toContain("- Q1：なぜ、この活動を始めようと思いましたか？: 上京して寂しかった");
    expect(p).toContain("- 活動の軸: 未入力");
    expect(p).toContain("- どんな人に投稿を届けたいか: 28歳前後の会社員");
    expect(p).toContain("- 最終的に読者に取ってほしい行動: 未入力");
    expect(p).toContain("- 近い人間性: 敬語ベース");
    expect(p).not.toContain("プロフィールの下書き");
    expect(p).not.toContain("■プロフィール・固定投稿");
    expect(p).toContain("項目を勝手に書き直さないでください");
    expect(p).toContain("多くても10問");
  });
});

describe("buildAxisPrompt（FR-036）", () => {
  it("5問の問いと答え（空は未入力）と、3案を目印で囲む頼み方が入る", () => {
    const v = emptyStrategyValues();
    v.purposeOrigin = "上京して寂しかった";
    const p = buildAxisPrompt(v);
    expect(p).toContain("- なぜ、この活動を始めようと思いましたか？: 上京して寂しかった");
    expect(p).toContain("- この活動を通して、自分自身はどうなりたいですか？: 未入力");
    expect(p).toContain("「活動の軸」の案を3つ");
    expect(p).toContain(`${FINAL_BEGIN}\n1. (案)\n2. (案)\n3. (案)\n${FINAL_END}`);
  });
});

// specs/018-strategy-ai-sparring FR-006・FR-007、contracts/prompt-template.md 1
describe("buildSparringPrompt", () => {
  it("質問の対象ごとに、名前・考えること・ヒント・今の答えが入る。活動の軸はヒントの行がない", () => {
    const v = emptyStrategyValues();
    v.targetPersona = "20代会社員";
    const p = buildSparringPrompt(v, ["targetPersona", "activityAxis"]);
    expect(p).toContain("下の2項目を、一緒に考えて完成させてください");
    expect(p).toContain("【1】どんな人に投稿を届けたいか\n考えること: 年齢や職業だけでなく、今どんな状況にいる人か");
    expect(p).toContain("コツ: 年齢・職業で終わらせず");
    expect(p).toContain("悪い例: 20代会社員");
    expect(p).toContain("足してみたい観点: 平日の終わり方と、休日の過ごし方・よく見ているSNSやアカウント・お金と時間の余裕");
    expect(p).toContain("今の私の答え: 20代会社員");
    const axis = p.slice(p.indexOf("【2】活動の軸"), p.indexOf("■進め方"));
    expect(axis).toContain("考えること: Q1〜Q5の答えを、短い言葉にまとめたもの");
    expect(axis).toContain("今の私の答え: 未入力");
    expect(axis).not.toContain("コツ:");
  });

  it("質問の対象ではない項目は、入力のあるものだけを文脈に入れる。近い人間性は文脈にだけ入り、下書きはどこにも入らない", () => {
    const v = emptyStrategyValues();
    v.finalAction = "公式LINEに登録";
    v.tonePreset = "polite_warm";
    v.profileBioDraft = "プロフィールの下書き";
    v.pinnedPostDraft1 = "固定投稿の下書き";
    const p = buildSparringPrompt(v, ["targetPersona"]);
    expect(p).toContain("■ほかの項目に書いたこと(参考。食い違わないように)");
    expect(p).toContain("- 最終的に読者に取ってほしい行動: 公式LINEに登録");
    expect(p).toContain("- 近い人間性: 丁寧・温かい");
    expect(p).not.toContain("【項目：近い人間性】");
    expect(p).not.toContain("- 来てほしくない人:");
    expect(p).not.toContain("下書き");
    expect(p).not.toContain("- どんな人に投稿を届けたいか:");
  });

  it("文脈がなければ、その節を入れない", () => {
    expect(buildSparringPrompt(emptyStrategyValues(), ["targetPersona"])).not.toContain("■ほかの項目に書いたこと");
  });

  it("進め方の5点と、対象の順の完成版の形が入る", () => {
    const p = buildSparringPrompt(emptyStrategyValues(), ["realWorries", "finalAction"]);
    expect(p).toContain("一度に1〜2問ずつ質問してください");
    expect(p).toContain("私の答えにないこと(事実・数字・エピソード)は作らないでください");
    expect(p).toContain("その文を生かして足したり直したりしてください。別の内容に書き換えないでください");
    expect(p).toContain("重なりや食い違いがないように");
    expect(p).toContain("「完成版を出して」と送ったら");
    const form = p.slice(p.indexOf("■完成版の形"));
    expect(form).toContain(`【項目：ターゲットの本音の悩み】\n(完成版)\n${SPARRING_ITEM_END}`);
    expect(form.indexOf("【項目：ターゲットの本音の悩み】")).toBeLessThan(form.indexOf("【項目：最終的に読者に取ってほしい行動】"));
  });

  it("発信テーマの掛け合わせが対象のときだけ、候補を出して相談する頼み方を足す", () => {
    expect(buildSparringPrompt(emptyStrategyValues(), ["contentThemeMix"])).toContain("候補を3つ以上出し");
    expect(buildSparringPrompt(emptyStrategyValues(), ["realWorries"])).not.toContain("候補を3つ以上出し");
  });

  it("長い入力でも削らない", () => {
    const v = emptyStrategyValues();
    for (const k of SPARRING_KEYS) v[k] = `${k}:` + "あ".repeat(1990);
    const p = buildSparringPrompt(v, [...SPARRING_KEYS]);
    for (const k of SPARRING_KEYS) expect(p).toContain(`${k}:` + "あ".repeat(1990));
  });
});


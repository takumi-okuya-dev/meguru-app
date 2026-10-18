import { describe, expect, it } from "vitest";
import {
  PURPOSE_KEYS,
  STRATEGY_FIELDS,
  STRATEGY_SECTIONS,
  STRATEGY_TEXT_KEYS,
  STRATEGY_TOTAL,
  TONE_PRESETS,
  countFilled,
  emptyStrategyValues,
} from "../src/strategy";

describe("strategy", () => {
  it("課題は26項目（目的の6項目＋数える16項目＋下書き4項目）と、近い人間性の7つの選択肢を持つ（specs/014 FR-050）", () => {
    expect(STRATEGY_FIELDS).toHaveLength(26);
    expect(STRATEGY_FIELDS.filter((f) => f.counted)).toHaveLength(16);
    expect(STRATEGY_TOTAL).toBe(16);
    expect(STRATEGY_FIELDS.filter((f) => !f.counted).map((f) => f.key)).toEqual([
      "purposeOrigin",
      "purposeSelf",
      "purposeOthers",
      "purposeFuture",
      "purposeStance",
      "activityAxis",
      "profileBioDraft",
      "pinnedPostDraft1",
      "pinnedPostDraft2",
      "pinnedPostDraft3",
    ]);
    expect(TONE_PRESETS.map((t) => t.label)).toEqual([
      "元気・カジュアル",
      "丁寧・温かい",
      "敬語ベース",
      "ため口・フランク",
      "内省的・静かめ",
      "情熱的・熱量高め",
      "ユーモア・自虐混じり",
    ]);
  });

  it("入力済み項目数：下書きは数えず、空白だけは未入力、近い人間性は null 以外で入力済み（FR-005）", () => {
    const v = emptyStrategyValues();
    expect(countFilled(v)).toBe(0);
    v.finalAction = "一緒に活動してもらう";
    v.realWorries = "  \n ";
    v.profileBioDraft = "下書き";
    expect(countFilled(v)).toBe(1);
    v.tonePreset = "polite_warm";
    expect(countFilled(v)).toBe(2);
  });

  it("目的の6キーは先頭にあり、区分 purpose にある（specs/014 research.md R3）", () => {
    expect(PURPOSE_KEYS).toEqual(["purposeOrigin", "purposeSelf", "purposeOthers", "purposeFuture", "purposeStance", "activityAxis"]);
    expect(STRATEGY_TEXT_KEYS.slice(0, 6)).toEqual([...PURPOSE_KEYS]);
    expect(STRATEGY_FIELDS.slice(0, 6).every((f) => f.section === "purpose")).toBe(true);
    expect(STRATEGY_FIELDS[0]!.label).toBe("Q1：なぜ、この活動を始めようと思いましたか？");
    expect(STRATEGY_FIELDS[5]!.label).toBe("活動の軸");
  });

  it("区分の名前から「課題①〜③」を外し、目的を先頭に置く（specs/014 FR-019）", () => {
    expect(STRATEGY_SECTIONS.map((s) => [s.id, s.title, s.chip])).toEqual([
      ["purpose", "活動の目的・在り方", "目的"],
      ["sales", "営業導線設計", "営業導線"],
      ["account", "アカウント設計", "アカウント"],
      ["funnel", "集客導線設計", "集客導線"],
      ["tone", "人柄（トンマナ）", "人柄"],
      ["other", "その他", "その他"],
      ["drafts", "プロフィール・固定投稿（下書き）", "下書き"],
    ]);
  });

  it("目的の5問と活動の軸は、入力済み項目数（n/16）に数えない（specs/014 FR-020、SC-007）", () => {
    const v = emptyStrategyValues();
    for (const k of PURPOSE_KEYS) v[k] = "書いた";
    expect(countFilled(v)).toBe(0);
  });
});

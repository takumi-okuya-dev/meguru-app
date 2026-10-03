import { describe, expect, it } from "vitest";
import { STRATEGY_FIELDS, STRATEGY_TOTAL, TONE_PRESETS, countFilled, emptyStrategyValues } from "../src/strategy";

describe("strategy", () => {
  it("課題は20項目（数える16項目＋下書き4項目）と、近い人間性の7つの選択肢を持つ", () => {
    expect(STRATEGY_FIELDS).toHaveLength(20);
    expect(STRATEGY_FIELDS.filter((f) => f.counted)).toHaveLength(16);
    expect(STRATEGY_TOTAL).toBe(16);
    expect(STRATEGY_FIELDS.filter((f) => !f.counted).map((f) => f.key)).toEqual([
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
});

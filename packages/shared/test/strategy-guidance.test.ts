// 考えるヒント（specs/014-strategy-guidance FR-001・FR-003、SC-001、contracts/hints.md）。
import { describe, expect, it } from "vitest";
import { STRATEGY_FIELDS } from "../src/strategy";
import { HINTED_KEYS, STRATEGY_HINTS } from "../src/strategy-guidance";

describe("STRATEGY_HINTS", () => {
  it("目的の5問・数える16項目の21項目にヒントがあり、活動の軸と下書きにはない（SC-001）", () => {
    const expected = STRATEGY_FIELDS.filter(
      (f) => f.counted || (f.section === "purpose" && f.key !== "activityAxis"),
    ).map((f) => f.key);
    expect(expected).toHaveLength(21);
    expect([...HINTED_KEYS]).toEqual(expected);
    expect(Object.keys(STRATEGY_HINTS).sort()).toEqual([...expected].sort());
  });

  it("各ヒントに、コツ・悪い例・良い例・足してみたら2〜3個・こんな場合は・もっと良くするなら がある（FR-001）", () => {
    for (const key of HINTED_KEYS) {
      const h = STRATEGY_HINTS[key];
      expect(h.tip, key).not.toBe("");
      expect(h.bad, key).not.toBe("");
      expect(h.good, key).not.toBe("");
      expect(h.more.length, key).toBeGreaterThanOrEqual(2);
      expect(h.more.length, key).toBeLessThanOrEqual(3);
      expect(h.whatIf, key).not.toBe("");
      expect(h.better, key).not.toBe("");
    }
  });

  it("目安の文字数は、近い人間性だけ持たない（FR-010・FR-011）", () => {
    for (const key of HINTED_KEYS) {
      if (key === "tonePreset") expect(STRATEGY_HINTS[key].minChars).toBeNull();
      else expect(STRATEGY_HINTS[key].minChars, key).toBeGreaterThan(0);
    }
    expect(STRATEGY_HINTS.targetPersona.minChars).toBe(40);
    expect(STRATEGY_HINTS.contentThemeMix.minChars).toBe(10);
  });

  it("発信テーマの掛け合わせだけが★特に大事で、考え方の説明を持つ（FR-003）", () => {
    const starred = HINTED_KEYS.filter((k) => STRATEGY_HINTS[k].star);
    expect(starred).toEqual(["contentThemeMix"]);
    expect(STRATEGY_HINTS.contentThemeMix.starNote).toContain("売りたいもの × ターゲットが共感するテーマ");
  });

  it("ターゲットの悪い例・良い例は contracts/hints.md のとおり", () => {
    expect(STRATEGY_HINTS.targetPersona.bad).toBe("20代会社員");
    expect(STRATEGY_HINTS.targetPersona.good).toBe(
      "28歳前後の会社員。仕事は嫌いではないけれど、30歳が近づいてきて、このままでいいのかなと少し焦っている人",
    );
  });
});

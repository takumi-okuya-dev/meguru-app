// 考えるヒント（specs/014-strategy-guidance FR-001・FR-003、SC-001、contracts/hints.md）。
import { describe, expect, it } from "vitest";
import { STRATEGY_FIELDS, emptyStrategyValues } from "../src/strategy";
import { HINTED_KEYS, STRATEGY_HINTS, checkStrategy } from "../src/strategy-guidance";

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

describe("checkStrategy（FR-010〜FR-016、research.md R2）", () => {
  it("空白・改行だけは未入力、目安ちょうどは十分、目安未満は短め", () => {
    const v = emptyStrategyValues();
    v.finalAction = "  \n ";
    v.targetPersona = "あ".repeat(40);
    v.realWorries = "あ".repeat(29);
    const c = checkStrategy(v);
    expect(c.items.finalAction).toEqual({ status: "empty", chars: 0 });
    expect(c.items.targetPersona).toEqual({ status: "ok", chars: 40 });
    expect(c.items.realWorries).toEqual({ status: "short", chars: 29 });
  });

  it("文字数は前後の空白を除いて数える", () => {
    const v = emptyStrategyValues();
    v.postGenres = "  あいうえおかきくけこ  ";
    expect(checkStrategy(v).items.postGenres).toEqual({ status: "ok", chars: 10 });
  });

  it("近い人間性は選んでいれば十分、選んでいなければ未入力", () => {
    const v = emptyStrategyValues();
    expect(checkStrategy(v).items.tonePreset.status).toBe("empty");
    v.tonePreset = "polite_warm";
    expect(checkStrategy(v).items.tonePreset.status).toBe("ok");
  });

  it("完了は16項目の十分の数、要確認は16項目と目的の5問の短めの数、目的は5問の十分の数", () => {
    const v = emptyStrategyValues();
    v.finalAction = "公式LINEに登録して、月1回の交流会に参加してもらう";
    v.tonePreset = "formal";
    v.realWorries = "将来が不安";
    v.purposeOrigin = "あ".repeat(30);
    v.purposeSelf = "短い";
    v.activityAxis = "軸";
    v.profileBioDraft = "下書き";
    const c = checkStrategy(v);
    expect(c.done).toBe(2);
    expect(c.review).toBe(2);
    expect(c.purposeDone).toBe(1);
  });

  it("次におすすめ：表示の順で最初の未入力、なければ最初の短め、なければ null", () => {
    const v = emptyStrategyValues();
    expect(checkStrategy(v).next).toBe("purposeOrigin");
    for (const k of HINTED_KEYS) {
      if (k === "tonePreset") v.tonePreset = "formal";
      else v[k] = "あ".repeat(STRATEGY_HINTS[k].minChars ?? 1);
    }
    expect(checkStrategy(v).next).toBeNull();
    v.funnelDesign = "短い";
    v.successMetrics = "";
    expect(checkStrategy(v).next).toBe("successMetrics");
    v.successMetrics = "あ".repeat(10);
    expect(checkStrategy(v).next).toBe("funnelDesign");
  });

  it("区分ごとの十分の数と項目数を返す。下書きは数を持たない", () => {
    const v = emptyStrategyValues();
    v.finalAction = "公式LINEに登録して、月1回の交流会に参加してもらう";
    v.purposeOrigin = "あ".repeat(30);
    const c = checkStrategy(v);
    expect(c.sections).toEqual({
      purpose: { done: 1, total: 5 },
      sales: { done: 1, total: 5 },
      account: { done: 0, total: 3 },
      funnel: { done: 0, total: 4 },
      tone: { done: 0, total: 2 },
      other: { done: 0, total: 2 },
      drafts: null,
    });
  });
});

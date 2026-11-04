import { describe, expect, it } from "vitest";
import { FEATURE_LABELS, FEATURES, isFeature } from "../src/features";

describe("機能のまとまり（specs/019 data-model.md）", () => {
  it("3つで、この順", () => {
    expect(FEATURES).toEqual(["autopost", "strategy", "team"]);
  });

  it("すべてのまとまりに画面の名前がある", () => {
    expect(FEATURES.map((f) => FEATURE_LABELS[f])).toEqual(["自動投稿", "戦略", "チーム"]);
  });

  it("isFeature は3つだけを受け付ける", () => {
    expect(FEATURES.every(isFeature)).toBe(true);
    expect(isFeature("stock")).toBe(false);
    expect(isFeature(undefined)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { PLANS, highestPlan, initialPlanFor, limitFor, limitForOwnedPlans } from "../src/plans";

describe("plans", () => {
  it("プランは順位順に並ぶ", () => {
    expect(PLANS).toEqual(["auto-only", "auto-grower", "multi-account", "team"]);
  });

  it("上限：プラン1・2は1件、プラン3・4は5件（FR-015）", () => {
    expect(limitFor("auto-only")).toBe(1);
    expect(limitFor("auto-grower")).toBe(1);
    expect(limitFor("multi-account")).toBe(5);
    expect(limitFor("team")).toBe(5);
  });

  it("最上位プランを選ぶ（FR-016）", () => {
    expect(highestPlan(["auto-only", "multi-account", "auto-grower"])).toBe("multi-account");
    expect(highestPlan([])).toBeNull();
  });

  it("保有0件の上限は auto-only の上限（1件）", () => {
    expect(limitForOwnedPlans([])).toBe(1);
    expect(limitForOwnedPlans(["auto-only", "multi-account"])).toBe(5);
  });

  it("初期プラン：最初の1件は auto-only、2件目以降は最上位プランを引き継ぐ（FR-014）", () => {
    expect(initialPlanFor([])).toBe("auto-only");
    expect(initialPlanFor(["auto-only"])).toBe("auto-only");
    expect(initialPlanFor(["auto-only", "multi-account"])).toBe("multi-account");
  });
});

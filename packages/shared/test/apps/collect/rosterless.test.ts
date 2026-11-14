// 名簿なしの仮の区分（specs/collect/004-rosterless-check-in research.md R3、tasks.md T003）。
import { describe, expect, it } from "vitest";
import { mediaInOrder, provisionalTier, sameNameIds, tierUndecidedFor } from "../../../src/apps/collect/rosterless";

const tier = (name: string, amount: number, position: number) => ({ name, amount, position });

describe("名簿なしの仮の区分", () => {
  it("区分が1つなら、その区分で、受付で決める必要はない", () => {
    const tiers = [tier("通常", 3000, 0)];
    expect(provisionalTier(tiers)?.name).toBe("通常");
    expect(tierUndecidedFor(tiers)).toBe(false);
  });

  it("区分が2つ以上なら、0円を除いた最も安い区分を仮に入れ、受付で決める", () => {
    const tiers = [tier("通常", 3000, 0), tier("早割", 2500, 1), tier("招待", 0, 2)];
    expect(provisionalTier(tiers)?.name).toBe("早割");
    expect(tierUndecidedFor(tiers)).toBe(true);
  });

  it("0円の区分も数える（通常と招待の2つなら、受付で決める）", () => {
    const tiers = [tier("通常", 3000, 0), tier("招待", 0, 1)];
    expect(provisionalTier(tiers)?.name).toBe("通常");
    expect(tierUndecidedFor(tiers)).toBe(true);
  });

  it("0円しかなければ、並びの最初", () => {
    expect(provisionalTier([tier("招待B", 0, 1), tier("招待A", 0, 0)])?.name).toBe("招待A");
  });

  it("同じ金額なら並びの先。区分がなければ undefined", () => {
    expect(provisionalTier([tier("B", 2000, 1), tier("A", 2000, 0), tier("C", 3000, 2)])?.name).toBe("A");
    expect(provisionalTier([])).toBeUndefined();
  });
});

describe("同じ名前の人", () => {
  it("ひらがなとカタカナ・空白の違いは同じ名前とみなし、1人だけの名前は入れない", () => {
    const ids = sameNameIds([
      { id: "a", name: "松本 れい" },
      { id: "b", name: "松本　レイ" },
      { id: "c", name: "井上 そら" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("媒体の並び", () => {
  it("掲載済みの媒体を先に、残りは 001 の並びのまま", () => {
    expect(mediaInOrder(["peatix", "minato"])).toEqual(["minato", "peatix", "kokuchpro", "tunagate", "jimoty", "youtrust", "walk_in", "other"]);
    expect(mediaInOrder()).toEqual(["minato", "kokuchpro", "tunagate", "jimoty", "peatix", "youtrust", "walk_in", "other"]);
  });
});

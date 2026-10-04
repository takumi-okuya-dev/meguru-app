import { describe, expect, it } from "vitest";
import { findNgWords, normalizeNgWord } from "../src/ng-words";

const ng = (...words: string[]) => words.map((word) => ({ word, normalized: normalizeNgWord(word) }));

describe("NGワードの照合（specs/004-review-approval FR-015・FR-016、research.md R4）", () => {
  it("全角／半角・大文字／小文字の違いを同じとみなす", () => {
    expect(findNgWords("abcな話", ng("ＡＢＣ"))).toHaveLength(1);
    expect(findNgWords("Abcな話", ng("ＡＢＣ"))).toHaveLength(1);
    expect(findNgWords("アイの話", ng("ｱｲ"))).toHaveLength(1);
  });

  it("ひらがなとカタカナ、ひらがなと漢字は別とみなす", () => {
    expect(findNgWords("ぜったいに伸びる", ng("絶対"))).toEqual([]);
    expect(findNgWords("あいの話", ng("アイ"))).toEqual([]);
  });

  it("言葉の途中に含まれる場合も検知する", () => {
    expect(findNgWords("絶対的な方法", ng("絶対"))).toEqual([{ word: "絶対", ranges: [[0, 2]] }]);
  });

  it("元の本文の位置で範囲を返す（正規化で長さが変わる文字の後ろ）", () => {
    const body = "㌔走ると絶対";
    const [hit] = findNgWords(body, ng("絶対"));
    expect(hit!.ranges).toEqual([[4, 6]]);
    expect(body.slice(4, 6)).toBe("絶対");
  });

  it("同じ語が2回あれば範囲を2つ返す", () => {
    expect(findNgWords("絶対に絶対", ng("絶対"))[0]!.ranges).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it("重なる複数のNGワードもそれぞれ返す", () => {
    const hits = findNgWords("必ず儲かる", ng("必ず儲かる", "儲かる"));
    expect(hits.map((h) => h.word)).toEqual(["必ず儲かる", "儲かる"]);
  });

  it("NGワードがなければ空", () => {
    expect(findNgWords("絶対", [])).toEqual([]);
  });

  it("登録用の正規化は前後の空白を除く", () => {
    expect(normalizeNgWord("  ＡＢＣ ")).toBe("abc");
  });
});

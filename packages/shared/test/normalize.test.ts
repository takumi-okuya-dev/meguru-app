import { describe, expect, it } from "vitest";
import { normalizeForMatch, toOriginalRange } from "../src/normalize";

describe("照合用の正規化（specs/004-review-approval research.md R4）", () => {
  it("全角／半角と大文字／小文字をそろえる", () => {
    expect(normalizeForMatch("ＡＢＣ").normalized).toBe("abc");
    expect(normalizeForMatch("Abc").normalized).toBe("abc");
    expect(normalizeForMatch("ｱｲ").normalized).toBe("アイ");
    expect(normalizeForMatch("１００％").normalized).toBe("100%");
  });

  it("ひらがなとカタカナは変えない", () => {
    expect(normalizeForMatch("ア").normalized).toBe("ア");
    expect(normalizeForMatch("あ").normalized).toBe("あ");
  });

  it("正規化で長さが変わる文字の後ろでも、元の位置に戻せる", () => {
    const text = "㌔の後に絶対";
    const { normalized, toOriginal } = normalizeForMatch(text);
    expect(normalized).toBe("キロの後に絶対");
    const start = normalized.indexOf("絶対");
    expect(toOriginalRange(toOriginal, start, start + 2)).toEqual([text.indexOf("絶対"), text.indexOf("絶対") + 2]);
  });

  it("絵文字（サロゲートペア）の前後でも、元の位置に戻せる", () => {
    const text = "😀ＡＢＣ😀";
    const { normalized, toOriginal } = normalizeForMatch(text);
    const start = normalized.indexOf("abc");
    expect(toOriginalRange(toOriginal, start, start + 3)).toEqual([2, 5]);
  });

  it("対応表の最後は元の長さ", () => {
    const { toOriginal, normalized } = normalizeForMatch("ab");
    expect(toOriginal).toHaveLength(normalized.length + 1);
    expect(toOriginal.at(-1)).toBe(2);
  });
});

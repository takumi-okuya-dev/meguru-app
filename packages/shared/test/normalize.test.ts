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

describe("濁点・半濁点の付いた半角カナ（PR #5 のCodexレビュー）", () => {
  it("「ｶﾞ」「ﾊﾟ」を全角の1文字にそろえる", () => {
    expect(normalizeForMatch("ｶﾞﾝﾊﾞﾙ").normalized).toBe("ガンバル");
    expect(normalizeForMatch("ﾊﾟﾝ").normalized).toBe("パン");
  });

  it("まとめた範囲も、元の本文の位置に戻せる", () => {
    const text = "朝ｶﾞﾝﾊﾞﾙ";
    const { normalized, toOriginal } = normalizeForMatch(text);
    const start = normalized.indexOf("ガンバル");
    expect(toOriginalRange(toOriginal, start, start + 4)).toEqual([1, text.length]);
  });
});

// 照合の正準形は、見えない文字を落とさなければ1つにならない（セキュリティ監査 run-1）。
// NFKC はこれらを除去しない（除去は NFKC_Casefold と UTS-46 の仕事で、どちらも使っていない）。
// 登録側も同じ関数を使うので、本文に1文字挟むだけで `indexOf` が外れていた。
describe("見えない文字は、照合用の文字列に入れない", () => {
  // \p{Cf}（書式文字）
  it.each(["\u200b", "\u200c", "\u200d", "\u00ad", "\u2060", "\ufeff"])(
    "書式文字 %j を挟んでも、同じ文字列に正規化する",
    (invisible) => {
      expect(normalizeForMatch(`絶${invisible}対`).normalized).toBe("絶対");
    },
  );

  // 既定で無視される印のうち \p{M} のもの。JOINS_PREVIOUS が前の文字に吸収し、NFKC でも消えない。
  // `\p{Cf}` だけ落とす修正では、ここが抜け道として残る
  it.each(["\ufe0f", "\ufe00", "\u034f", "\u180b", "\u17b4"])(
    "既定で無視される印 %j を挟んでも、同じ文字列に正規化する",
    (invisible) => {
      expect(normalizeForMatch(`絶${invisible}対`).normalized).toBe("絶対");
    },
  );

  it("基底文字と結合文字の間に挟まれても、まとめる単位を割らない", () => {
    // 外側のループの先頭だけで判定すると、「ｶ」+「ﾞ」が割れて「カ゛」になり、「ガ」に当たらない
    expect(normalizeForMatch("ｶ\u200bﾞﾝ").normalized).toBe("ガン");
    expect(normalizeForMatch("ﾊ\ufe0fﾟﾝ").normalized).toBe("パン");
  });

  it("制御文字は落とさない（改行は文の境目として使っている）", () => {
    // policy.ts の NEAR が `[^。\n]{0,15}` で改行を文の境目にしているので、ここで消すと
    // 文をまたいだ誤検知が増える
    expect(normalizeForMatch("絶\n対").normalized).toBe("絶\n対");
  });

  it("落とした分も含めて、元の本文の位置に戻せる", () => {
    const text = "朝は絶\u200b対に稼げる";
    const { normalized, toOriginal } = normalizeForMatch(text);
    expect(normalized).toBe("朝は絶対に稼げる");
    const start = normalized.indexOf("絶対");
    // 元の本文では「絶」「U+200B」「対」の3文字分。強調する範囲は見えない文字を含む
    expect(toOriginalRange(toOriginal, start, start + 2)).toEqual([2, 5]);
  });

  it("対応表の性質は保つ（単調非減少で、最後は元の長さ）", () => {
    const text = "a\u200bb\ufe0fc";
    const { normalized, toOriginal } = normalizeForMatch(text);
    expect(normalized).toBe("abc");
    expect(toOriginal).toHaveLength(normalized.length + 1);
    expect(toOriginal.at(-1)).toBe(text.length);
    for (let i = 1; i < toOriginal.length; i++) expect(toOriginal[i]!).toBeGreaterThanOrEqual(toOriginal[i - 1]!);
  });

  it("見えない文字だけの本文は、空になる", () => {
    const { normalized, toOriginal } = normalizeForMatch("\u200b\ufe0f");
    expect(normalized).toBe("");
    expect(toOriginal).toEqual([2]);
  });
});

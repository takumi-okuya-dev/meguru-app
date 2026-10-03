import { describe, expect, it } from "vitest";
import { countChars, isBlank, isHttpUrl, normalizeKeyword } from "../src/text";

describe("text", () => {
  it("文字数はコードポイントで数え、絵文字1つは1文字（research.md R2）", () => {
    expect(countChars("abc")).toBe(3);
    expect(countChars("あいう")).toBe(3);
    expect(countChars("😀")).toBe(1);
    expect(countChars("a😀b")).toBe(3);
  });

  it("空白・改行だけは空とみなす", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("  \n\t　")).toBe(true);
    expect(isBlank(" a ")).toBe(false);
  });

  it("キーワードは NFKC → 前後の空白を除く → 小文字 で正規化する（research.md R5）", () => {
    expect(normalizeKeyword("ＡＩ")).toBe("ai");
    expect(normalizeKeyword(" ai ")).toBe("ai");
    expect(normalizeKeyword("Ai")).toBe("ai");
    expect(normalizeKeyword("ＡＩ　活用")).toBe("ai 活用");
  });

  it("http・https のURLだけを受け付ける（research.md R8）", () => {
    expect(isHttpUrl("https://example.com/a")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

// トークンの形の判定（specs/010-token-account-add research.md R1）
import { describe, expect, it } from "vitest";
import { cleanToken, isTokenShaped } from "../src/token";

const TOKEN = "THAAG" + "x".repeat(40) + "_-.|9";

describe("cleanToken", () => {
  it("前後の空白・改行・引用符を取り除く", () => {
    expect(cleanToken(`  "${TOKEN}"\n`)).toBe(TOKEN);
    expect(cleanToken(`'${TOKEN}'`)).toBe(TOKEN);
    expect(cleanToken("`" + TOKEN + "`\r\n")).toBe(TOKEN);
    expect(cleanToken(`\t${TOKEN}　`)).toBe(TOKEN);
  });

  it("中の文字は変えない", () => {
    expect(cleanToken(`a"b`)).toBe(`a"b`);
  });
});

describe("isTokenShaped", () => {
  it("32〜2048文字の英数字と _ - . | だけならトークンの形", () => {
    expect(isTokenShaped(TOKEN)).toBe(true);
    expect(isTokenShaped("a".repeat(32))).toBe(true);
    expect(isTokenShaped("a".repeat(2048))).toBe(true);
  });

  it("短すぎ・長すぎ・空白や他の記号・日本語はトークンの形ではない", () => {
    expect(isTokenShaped("a".repeat(31))).toBe(false);
    expect(isTokenShaped("a".repeat(2049))).toBe(false);
    expect(isTokenShaped(`${"a".repeat(20)} ${"b".repeat(20)}`)).toBe(false);
    expect(isTokenShaped("https://threads.com/oauth?access_token=abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(isTokenShaped("あ".repeat(40))).toBe(false);
    expect(isTokenShaped("")).toBe(false);
  });
});

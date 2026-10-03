import { describe, expect, it } from "vitest";
import { THREADS_LINK_LIMIT, THREADS_TEXT_LIMIT, countLinks, isOverThreadsLimit, threadsLength } from "../src/threads-text";

describe("Threadsの長さ（research.md R4、公式ドキュメント：500文字、絵文字はUTF-8のバイト数）", () => {
  it("日本語・英数字は1文字を1と数える", () => {
    expect(threadsLength("あ".repeat(100))).toBe(100);
    expect(threadsLength("abc 123")).toBe(7);
    expect(threadsLength("1行目\n2行目")).toBe(7);
  });

  it("絵文字はUTF-8のバイト数で数える", () => {
    expect(threadsLength("😀")).toBe(4);
    expect(threadsLength("🇯🇵")).toBe(8);
    // 👨‍👩‍👧 = 4 + 3(ZWJ) + 4 + 3(ZWJ) + 4
    expect(threadsLength("👨‍👩‍👧")).toBe(18);
    expect(threadsLength("あ😀い")).toBe(6);
  });

  it("リンクの数を数える", () => {
    expect(countLinks("https://a.example/x と http://b.example と www.c.example")).toBe(3);
    expect(countLinks("リンクなし")).toBe(0);
  });

  it("上限の判定：500を超えるか、リンクが5個を超えると上限超え", () => {
    expect(THREADS_TEXT_LIMIT).toBe(500);
    expect(THREADS_LINK_LIMIT).toBe(5);
    expect(isOverThreadsLimit("あ".repeat(500))).toBe(false);
    expect(isOverThreadsLimit("あ".repeat(501))).toBe(true);
    expect(isOverThreadsLimit("😀".repeat(125))).toBe(false);
    expect(isOverThreadsLimit("😀".repeat(126))).toBe(true);
    const links = (n: number) => Array.from({ length: n }, (_, i) => `https://e.example/${i}`).join(" ");
    expect(isOverThreadsLimit(links(5))).toBe(false);
    expect(isOverThreadsLimit(links(6))).toBe(true);
  });
});

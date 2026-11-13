// 集金管理の名前の扱い（specs/collect/001-event-day-collection research.md R9、tasks.md T008）。
import { describe, expect, it } from "vitest";
import { cleanPastedLine, looksLikeNonName, nameKey } from "../../../src";

describe("nameKey", () => {
  it("全角と半角・カタカナとひらがな・空白・大文字と小文字の違いをそろえる", () => {
    expect(nameKey("ﾔﾏﾀﾞ　タロウ")).toBe("やまだたろう");
    expect(nameKey("やまだ たろう")).toBe("やまだたろう");
    expect(nameKey("Ｔａｒｏ Yamada")).toBe("taroyamada");
    expect(nameKey("山田 太郎")).toBe("山田太郎");
  });

  it("濁点の付いた半角カナもまとめる", () => {
    expect(nameKey("ｶﾞｸ")).toBe(nameKey("ガク"));
  });

  it("空は空", () => {
    expect(nameKey("   ")).toBe("");
  });
});

describe("cleanPastedLine", () => {
  it("行の頭の番号・敬称・メールアドレス・電話番号を除く", () => {
    expect(cleanPastedLine("1. 松本 れい 様 matsumoto@example.com")).toBe("松本 れい");
    expect(cleanPastedLine("2. 井上 そら 様 090-1234-5678")).toBe("井上 そら");
    expect(cleanPastedLine("3. 木村 ゆうき さん")).toBe("木村 ゆうき");
  });

  it("記号や丸数字の頭も除く", () => {
    expect(cleanPastedLine("・佐藤 花子")).toBe("佐藤 花子");
    expect(cleanPastedLine("① 鈴木一郎さん")).toBe("鈴木一郎");
    expect(cleanPastedLine("- 田中")).toBe("田中");
    expect(cleanPastedLine("12) 高橋 様")).toBe("高橋");
  });

  it("名前の一部の「さん」は消さない", () => {
    expect(cleanPastedLine("さんぺい")).toBe("さんぺい");
  });

  it("空の行・取り除いて何も残らない行は空", () => {
    expect(cleanPastedLine("")).toBe("");
    expect(cleanPastedLine("   ")).toBe("");
    expect(cleanPastedLine("4. 090-1111-2222")).toBe("");
  });

  it("全角の英数字・半角のカナをそろえる", () => {
    expect(cleanPastedLine("ﾔﾏﾀﾞ ﾀﾛｳ")).toBe("ヤマダ タロウ");
  });
});

describe("looksLikeNonName", () => {
  it("日付・金額・申込の行は真", () => {
    expect(looksLikeNonName("申込日 11/20")).toBe(true);
    expect(looksLikeNonName("一般チケット 3,000円")).toBe(true);
    expect(looksLikeNonName("2026年11月20日 19:00")).toBe(true);
    expect(looksLikeNonName("")).toBe(true);
    expect(looksLikeNonName("123")).toBe(true);
  });

  it("名前は偽", () => {
    expect(looksLikeNonName("松本 れい")).toBe(false);
    expect(looksLikeNonName("Taro Yamada")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { splitDrafts } from "../src/drafts";

describe("splitDrafts（research.md R3）", () => {
  it("分割の基本：@@@ だけの行で分け、順番を保つ（FR-010、SC-003）", () => {
    expect(splitDrafts("A\n@@@\nB\n@@@\nC")).toEqual({ parts: ["A", "B", "C"], delimiterFound: true });
  });

  it("区切りの揺れ：前後の空白・全角・4つ以上・太字・コードの行でも分ける", () => {
    const text = ["A", " @@@ ", "B", "＠＠＠", "C", "@@@@", "D", "**@@@**", "E", "`@@@`", "F", "__@@@__", "G"].join("\n");
    expect(splitDrafts(text).parts).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });

  it("本文の中の @@@（行の一部）では分けない", () => {
    expect(splitDrafts("メールは a@@@b のように\n@@@\n次")).toEqual({
      parts: ["メールは a@@@b のように", "次"],
      delimiterFound: true,
    });
  });

  it("前後の空白・空の部分：前後の空白は除き、最初・最後・連続した区切りの間の空の部分は捨てる", () => {
    const text = "@@@\n\n  一件目  \n\n@@@\n@@@\n二件目\n  \n@@@\n";
    expect(splitDrafts(text).parts).toEqual(["一件目", "二件目"]);
  });

  it("本文の中の改行・段落は保つ", () => {
    expect(splitDrafts("1行目\n\n3行目\n@@@\n次").parts).toEqual(["1行目\n\n3行目", "次"]);
  });

  it("改行 \\r\\n・\\r も扱える", () => {
    expect(splitDrafts("A\r\n@@@\r\nB\r@@@\rC").parts).toEqual(["A", "B", "C"]);
  });

  it("区切りなし：全体を前後の空白を除いて1件にし、delimiterFound: false（FR-011）", () => {
    expect(splitDrafts("  ひとつだけ\nの投稿  ")).toEqual({ parts: ["ひとつだけ\nの投稿"], delimiterFound: false });
  });

  it("区切りしかない・空白だけなら0件", () => {
    expect(splitDrafts("@@@\n@@@").parts).toEqual([]);
    expect(splitDrafts("   ").parts).toEqual([]);
  });

  it("外部LLMが付けた番号は消さず、そのまま本文に残す（spec エッジケース）", () => {
    expect(splitDrafts("1. 一件目\n@@@\n【2】二件目").parts).toEqual(["1. 一件目", "【2】二件目"]);
  });

  it("本文は元の文字のまま（全角英数字を NFKC で変えない）", () => {
    expect(splitDrafts("ＡＩの話\n@@@\n次").parts[0]).toBe("ＡＩの話");
  });
});

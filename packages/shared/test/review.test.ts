import { describe, expect, it } from "vitest";
import { normalizeNgWord } from "../src/ng-words";
import { REJECT_REASONS, checkPublishable, rejectReasonLabel } from "../src/review";

const ng = (...words: string[]) => words.map((word) => ({ word, normalized: normalizeNgWord(word) }));

describe("配信できるかの判定（specs/004-review-approval research.md R14）", () => {
  it("NGワードを含むと承認できない", () => {
    const r = checkPublishable("絶対に伸びる", ng("絶対"));
    expect(r.ngWords.map((h) => h.word)).toEqual(["絶対"]);
    expect(r.approvable).toBe(false);
  });

  it("Threadsの上限を超えると承認できない", () => {
    expect(checkPublishable("あ".repeat(501), []).overThreadsLimit).toBe(true);
    expect(checkPublishable("あ".repeat(501), []).approvable).toBe(false);
    const links = Array.from({ length: 6 }, (_, i) => `https://e${i}.example`).join(" ");
    expect(checkPublishable(links, []).approvable).toBe(false);
  });

  it("どちらもなければ承認できる", () => {
    const r = checkPublishable("今日の気づき", ng("絶対"));
    expect(r).toMatchObject({ ngWords: [], overThreadsLimit: false, approvable: true });
  });
});

describe("却下理由の候補（research.md R10）", () => {
  it("6つのコードと表示名", () => {
    expect(REJECT_REASONS).toEqual([
      { code: "similar", label: "似た投稿がある" },
      { code: "tone", label: "トーンが違う" },
      { code: "thin", label: "内容が薄い" },
      { code: "inaccurate", label: "事実と違う" },
      { code: "too_promotional", label: "宣伝っぽすぎる" },
      { code: "policy", label: "規約に触れそう" },
    ]);
    expect(rejectReasonLabel("tone")).toBe("トーンが違う");
  });
});

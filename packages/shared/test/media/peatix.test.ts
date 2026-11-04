// Peatix（specs/021-external-media contracts/media.md「Peatix」、tasks.md T014・T033）
import { describe, expect, it } from "vitest";
import { MEDIA_DEFINITIONS, buildListing, checkListing, workSteps } from "../../src";
import { itSource } from "./fixtures";

describe("Peatixの欄", () => {
  it("ステップ1〜5と、イベント名の上限45", () => {
    expect(MEDIA_DEFINITIONS.peatix.steps).toHaveLength(5);
    expect(MEDIA_DEFINITIONS.peatix.fields.find((f) => f.key === "title")!.max).toBe(45);
  });

  it("イベント名は日付を先頭に置く形（候補2案）、当日払いは無料チケット＋チケット名に金額", () => {
    const b = buildListing("peatix", itSource());
    expect(b.fields.title).toBe("【11/25(水)20時〜】IT交流会 ゆるく繋がる飲み会｜御徒町");
    expect(b.titleCandidates).toHaveLength(2);
    expect([b.fields.paymentStyle!.startsWith("当日払い"), b.fields.ticketName, b.fields.price]).toEqual([true, "参加費 5,000円（当日払い）", "0"]);
    expect(b.fields.format).toBe("会場開催");
  });

  it("作業のSTEPは10。最初はルールの確認、最後は公開", () => {
    const steps = workSteps("peatix", buildListing("peatix", itSource()).fields);
    expect(steps).toHaveLength(10);
    expect([steps[0]!.ruleCheck, steps[9]!.publish]).toEqual([true, true]);
  });
});

describe("Peatixのルール", () => {
  it("地図のURL・LINEの行が外れ、理由が残る", () => {
    const b = buildListing("peatix", itSource());
    expect(b.fields.body).not.toContain("maps.app.goo.gl");
    expect(b.fields.body).not.toContain("LINEでご案内");
    expect(b.fixes.map((f) => f.field)).toEqual(["body", "body"]);
  });

  it("イベント名が45文字を超えると赤。カバー画像・グループは参考", () => {
    const b = buildListing("peatix", itSource());
    const checks = checkListing("peatix", { ...b.fields, title: "あ".repeat(46) }, itSource());
    expect(checks[0]).toMatchObject({ level: "red", field: "title" });
    expect(checks.some((c) => c.message.includes("カバー画像"))).toBe(true);
    expect(checks.some((c) => c.message.includes("グループ"))).toBe(true);
  });
});

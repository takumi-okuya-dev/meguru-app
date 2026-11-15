// つなげーと（specs/021-external-media contracts/media.md「つなげーと」、tasks.md T015・T034）
import { describe, expect, it } from "vitest";
import { buildListing, checkListing, workSteps } from "../../src";
import { itSource } from "./fixtures";

describe("つなげーとの欄", () => {
  it("イベント名は60字まで・30字以上の形で人数を入れない。紹介文の冒頭3行は場所・日時・参加費", () => {
    const b = buildListing("tsunagate", itSource({ title: "IT交流会 25名限定 ゆるく繋がる飲み会" }));
    expect([...b.fields.title!].length).toBeLessThanOrEqual(60);
    expect([...b.fields.title!].length).toBeGreaterThanOrEqual(30);
    expect(b.fields.title).not.toMatch(/25名/);
    expect(b.fields.intro!.split("\n").slice(0, 3)).toEqual([
      "📍場所：バー「SHITEN（シテン）」（御徒町駅 徒歩3分）",
      "🗓日時：2026年11月25日(水) 20:00 〜 22:00",
      "💰参加費：5,000円（つなげーとでの事前決済）",
    ]);
    expect([b.fields.payment, b.fields.genderRatio, b.fields.exclusive]).toEqual(["事前決済（クレジット／Amazon Pay）", "設定しない", "チェックしない"]);
  });

  it("作業のSTEPは9。最後は公開と、自分も参加申し込み", () => {
    const steps = workSteps("tsunagate", buildListing("tsunagate", itSource()).fields);
    expect(steps).toHaveLength(9);
    expect(steps[8]!.notes.join()).toContain("参加申し込み");
  });
});

describe("つなげーとのルール", () => {
  it("地図のURL・紹介割引・LINEの行が外れる", () => {
    const b = buildListing("tsunagate", itSource());
    expect(b.fields.intro).not.toMatch(/maps\.app|紹介割引|LINE/);
    expect(b.fixes.map((f) => f.reason).join()).toContain("紹介");
  });

  it("「人脈づくり」などは黄。手数料・自分も参加・重複の禁止・人気の時間は参考", () => {
    const b = buildListing("tsunagate", itSource());
    const checks = checkListing("tsunagate", b.fields, itSource(), b.fixes.length);
    expect(checks.find((c) => c.level === "yellow" && c.field === "intro")!.message).toContain("人脈");
    const info = checks.filter((c) => c.level === "info").map((c) => c.message).join("\n");
    for (const w of ["手数料", "参加申し込み", "複数作る", "人気の時間", "自動で直した内容"]) expect(info).toContain(w);
  });
});

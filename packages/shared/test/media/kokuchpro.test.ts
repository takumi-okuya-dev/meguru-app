// こくちーずプロ（specs/021-external-media contracts/media.md「こくちーずプロ」、tasks.md T013・T032）
import { describe, expect, it } from "vitest";
import { MEDIA_DEFINITIONS, buildListing, checkListing, workSteps } from "../../src";
import { IT_EVENT, itSource } from "./fixtures";

const def = MEDIA_DEFINITIONS.kokuchpro;

describe("こくちーずプロの欄", () => {
  it("①〜⑦の区切りと、欄の並び・必須・登録後に変えられない・上限", () => {
    expect(def.steps).toHaveLength(7);
    expect(def.fields.slice(0, 2).map((f) => [f.key, f.required, f.immutable])).toEqual([
      ["format", true, true],
      ["pricing", true, true],
    ]);
    expect(def.fields.find((f) => f.key === "title")!.max).toBe(100);
    expect(def.fields.find((f) => f.key === "summary")!.max).toBe(80);
    expect(def.fields.filter((f) => f.defaultable).map((f) => f.key)).toEqual(["officeName", "officeTel", "officeEmail", "group"]);
  });

  it("IT交流会から、オフライン・有料・人脈／交流会・ITエンジニア交流会と理由を選ぶ", () => {
    const b = buildListing("kokuchpro", itSource({ defaults: { officeName: "港事務局" } }));
    expect([b.fields.format, b.fields.pricing, b.fields.genre, b.fields.subGenre]).toEqual(["オフライン", "有料", "人脈／交流会", "ITエンジニア交流会"]);
    expect(b.reasons.pricing).toContain("参加費がある");
    expect([b.fields.startDate, b.fields.startTime, b.fields.price, b.fields.capacity, b.fields.officeName]).toEqual(["2026-11-25", "20:00", "5000", "25", "港事務局"]);
    expect(b.fields.payment).toBe("個別支払（振込先などを自分で案内する）");
  });

  it("無料なら「無料」と「設定しない」、金額がなければ空", () => {
    const free = buildListing("kokuchpro", itSource({ event: { ...IT_EVENT, feeYen: 0 } }));
    expect([free.fields.pricing, free.fields.payment]).toEqual(["無料", "設定しない（無料イベント）"]);
    const none = buildListing("kokuchpro", itSource({ event: { ...IT_EVENT, feeYen: null } }));
    expect(none.fields.price).toBe("");
  });

  it("作業のSTEPは15。最初は「登録の最初の画面で、2つを選ぶ」、最後はルールの確認と公開、1日3件まで", () => {
    const steps = workSteps("kokuchpro", buildListing("kokuchpro", itSource()).fields);
    expect(steps).toHaveLength(15);
    expect(steps[0]!.title).toBe("登録の最初の画面で、2つを選ぶ");
    expect(steps[14]!).toMatchObject({ title: "ルールの確認 → 最終確認 → 公開", ruleCheck: true, publish: true });
    expect(steps[14]!.notes.join()).toContain("3件まで");
  });
});

describe("こくちーずプロのルール", () => {
  it("自動の直しはしない（地図のURL・紹介割引が残る）", () => {
    const b = buildListing("kokuchpro", itSource());
    expect(b.fixes).toEqual([]);
    expect(b.fields.body).toContain("maps.app.goo.gl");
    expect(b.fields.body).toContain("紹介割引");
  });

  it("必須の欄が空なら黄、1日3件までは参考", () => {
    const b = buildListing("kokuchpro", itSource());
    const checks = checkListing("kokuchpro", b.fields, itSource());
    expect(checks.some((c) => c.level === "yellow" && c.field === "officeName")).toBe(true);
    expect(checks.some((c) => c.level === "info" && c.message.includes("3件まで"))).toBe(true);
  });
});

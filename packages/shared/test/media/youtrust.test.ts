// YOUTRUST（specs/021-external-media contracts/media.md「YOUTRUST」、tasks.md T017・T036）
import { describe, expect, it } from "vitest";
import { buildListing, checkListing, workSteps } from "../../src";
import { IT_EVENT, itSource } from "./fixtures";

describe("YOUTRUSTの欄", () => {
  it("タイトルは絵文字を外し「＠エリア」、対象者は箇条書き", () => {
    const b = buildListing("youtrust", itSource({ title: "🍻IT交流会 ゆるく繋がる飲み会" }));
    expect(b.fields.title).toBe("IT交流会 ゆるく繋がる飲み会＠御徒町");
    expect(b.fields.audience).toBe("・IT・コンサル系の方\n・初参加・一人参加歓迎");
    expect(b.fields.format).toBe("オフライン（会場に集まる）");
  });

  it("作業のSTEPは12", () => {
    expect(workSteps("youtrust", buildListing("youtrust", itSource()).fields)).toHaveLength(12);
  });
});

describe("YOUTRUSTのルール", () => {
  it("「完全紹介・会員制」と他サイトのURLの行が外れる", () => {
    const b = buildListing("youtrust", itSource());
    expect(b.fields.summary).not.toMatch(/完全紹介|maps\.app/);
    expect(b.fixes.some((f) => f.reason.includes("限られて見える"))).toBe(true);
  });

  it("住所が空なら黄。サムネイル・主催・公開後に戻せない・通知の時刻は参考", () => {
    const src = itSource({ event: { ...IT_EVENT, prefecture: null, address: null, building: null } });
    const checks = checkListing("youtrust", buildListing("youtrust", src).fields, src);
    expect(checks.some((c) => c.level === "yellow" && c.field === "address")).toBe(true);
    const info = checks.filter((c) => c.level === "info").map((c) => c.message).join("\n");
    for (const w of ["サムネイル", "主催", "下書きには戻せません", "22時"]) expect(info).toContain(w);
  });
});

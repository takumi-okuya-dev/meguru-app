// ジモティー（specs/021-external-media contracts/media.md「ジモティー」、tasks.md T016・T035）
import { describe, expect, it } from "vitest";
import { buildListing, checkListing, workSteps } from "../../src";
import { itSource } from "./fixtures";

describe("ジモティーの欄", () => {
  it("カテゴリーはパーティー、タイトルは日付と駅を前に「〜しませんか？」", () => {
    const b = buildListing("jmty", itSource());
    expect(b.fields.category).toBe("イベント ＞ パーティー（交流会・飲み会・BBQなど）");
    expect(b.fields.title).toBe("【11/25(水)】御徒町でIT交流会 ゆるく繋がる飲み会しませんか？🍻");
    expect([b.fields.prefecture, b.fields.station]).toEqual(["東京都", "御徒町駅"]);
  });

  it("内容の最初に日時・場所・参加費、最後に「詳細・お申し込み」と専用URL", () => {
    const b = buildListing("jmty", itSource());
    expect(b.fields.body!.split("\n")[0]).toBe("【日時】2026年11月25日(水) 20:00 〜 22:00");
    expect(b.fields.body!.endsWith("■詳細・お申し込み\nhttps://minato-place.com/events/2026-11-25")).toBe(true);
  });

  it("作業のSTEPは8", () => {
    expect(workSteps("jmty", buildListing("jmty", itSource()).fields)).toHaveLength(8);
  });
});

describe("ジモティーのルール", () => {
  it("LINE・地図のURLの行が外れ、案内のURLは最後の1か所だけ", () => {
    const b = buildListing("jmty", itSource({ content: "楽しい会です\n出会いもあります\nLINE: abc\nhttps://maps.app.goo.gl/x" }));
    expect(b.fields.body).not.toMatch(/LINE|出会い|maps\.app/);
    expect(b.fields.body!.match(/https?:\/\//g)).toHaveLength(1);
  });

  it("重複投稿の禁止・審査・画像500×500・連絡先は参考", () => {
    const info = checkListing("jmty", buildListing("jmty", itSource()).fields, itSource()).map((c) => c.message).join("\n");
    for (const w of ["重複", "審査", "500×500", "連絡先"]) expect(info).toContain(w);
  });
});

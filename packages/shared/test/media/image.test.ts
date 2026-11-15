// 画像のプロンプト（specs/021-external-media contracts/media.md「共通」、tasks.md T048）
import { describe, expect, it } from "vitest";
import { MEDIA, imagePrompt } from "../../src";
import { itSource } from "./fixtures";

const SIZES = { kokuchpro: "4:3", peatix: "1840×900", tsunagate: "4:3", jmty: "500×500", youtrust: "1200×630" } as const;

describe("画像のプロンプト", () => {
  it.each(MEDIA)("%s：イベントの情報・大きさ・入れてはいけないものが入る", (m) => {
    const p = imagePrompt(m, itSource(), "illustration");
    for (const w of ["IT交流会", "2026年11月25日(水)", "御徒町", "5,000円", SIZES[m], "QRコード", "口座"]) expect(p).toContain(w);
  });

  it("こくちーずプロは中央75%、イラスト型と写真を使う型で文が変わる", () => {
    expect(imagePrompt("kokuchpro", itSource(), "illustration")).toContain("75%");
    const a = imagePrompt("peatix", itSource(), "illustration");
    const b = imagePrompt("peatix", itSource(), "photo");
    expect([a.includes("イラスト型"), b.includes("写真を使う型")]).toEqual([true, true]);
  });
});

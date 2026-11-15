// 外部媒体展開の入口（specs/021-external-media research.md R1〜R5、tasks.md T018・T037）
import { describe, expect, it } from "vitest";
import { MEDIA, POLISH_BODY, POLISH_END, POLISH_TITLE, buildListing, checkListing, listingAsText, parsePolishAnswer, polishPrompt, refixListing, workSteps } from "../../src";
import { IT_EVENT, itSource } from "./fixtures";

describe("組み立て", () => {
  it("5つの媒体すべてで作れる。イベントの情報がなければ日時の欄は空", () => {
    for (const m of MEDIA) {
      const b = buildListing(m, itSource());
      expect(b.fields.title, m).not.toBe("");
      expect(buildListing(m, itSource({ event: null })).fields.startDate ?? "", m).toBe("");
    }
  });

  it("STEPに値を差し込む", () => {
    const steps = workSteps("peatix", buildListing("peatix", itSource()).fields);
    expect(steps[2]!.values[0]).toMatchObject({ field: { key: "title" }, value: expect.stringContaining("IT交流会") });
  });

  it("まとめてコピーは、区切りごとに欄の名前つき", () => {
    const text = listingAsText("peatix", buildListing("peatix", itSource()).fields);
    expect(text).toContain("【Peatixの掲載内容】");
    expect(text).toContain("■ステップ1｜基本情報");
    expect(text).toContain("【イベント名】");
  });
});

describe("ルールのチェック", () => {
  it("直した値で出し直す。終了・参加費の金額がなければ黄。赤 → 黄 → 参考の順", () => {
    const src = itSource({ event: { ...IT_EVENT, endAt: null, feeYen: null } });
    const b = buildListing("peatix", src);
    const checks = checkListing("peatix", { ...b.fields, title: "あ".repeat(50) }, src);
    expect(checks[0]!.level).toBe("red");
    expect(checks.filter((c) => c.level === "yellow").map((c) => c.message).join()).toMatch(/終了の日時.*参加費の金額|参加費の金額.*終了の日時/);
    const levels = checks.map((c) => c.level);
    expect(levels).toEqual([...levels].sort((a, b) => ["red", "yellow", "info"].indexOf(a) - ["red", "yellow", "info"].indexOf(b)));
  });

  it("貼った文にも自動の直しを通す（反映のあと・保存のとき）", () => {
    const b = buildListing("tsunagate", itSource());
    const r = refixListing("tsunagate", { ...b.fields, intro: "よい会です\nLINEで連絡ください" }, itSource());
    expect(r.fields.intro).toBe("よい会です");
    expect(r.fixes).toHaveLength(1);
  });
});

describe("AIと整える", () => {
  it("プロンプトに媒体の決まり・今のタイトルと本文・答えの目印が入る", () => {
    const b = buildListing("peatix", itSource());
    const p = polishPrompt("peatix", itSource(), b.fields);
    for (const w of ["Peatix", "45文字以内", b.fields.title, POLISH_TITLE, POLISH_BODY, POLISH_END]) expect(p).toContain(w);
  });

  it("答えを読む：目印あり・前後の文は無視・片方だけ・目印なし", () => {
    expect(parsePolishAnswer(`はい、整えました。\n${POLISH_TITLE}\n新しいタイトル\n${POLISH_BODY}\n新しい本文\n2行め\n${POLISH_END}\nほかに何か…`)).toEqual({
      title: "新しいタイトル",
      body: "新しい本文\n2行め",
    });
    expect(parsePolishAnswer(`${POLISH_TITLE}\nタイトルだけ`)).toEqual({ title: "タイトルだけ", body: null });
    expect(parsePolishAnswer("目印のない答え")).toEqual({ title: null, body: null });
  });
});

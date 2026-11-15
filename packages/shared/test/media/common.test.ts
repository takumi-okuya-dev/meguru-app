// 媒体に共通の部品（specs/021-external-media research.md R4、tasks.md T006）
import { describe, expect, it } from "vitest";
import { applyFixRules, eventDateParts, formatEventWhen, isEventDateTime } from "../../src";
import { FIX_BANK, FIX_EMAIL, FIX_LINE, FIX_PHONE, FIX_URL, dateFields, lengthOf, spacedDateTime } from "../../src/media/common";
import { IT_EVENT } from "./fixtures";

describe("日時", () => {
  it("YYYY-MM-DDTHH:mm だけを受け、日付・時刻・曜日に分ける", () => {
    expect([isEventDateTime("2026-11-25T20:00"), isEventDateTime("2026-02-30T20:00"), isEventDateTime("2026-11-25 20:00")]).toEqual([true, false, false]);
    expect(eventDateParts("2026-11-25T20:00")).toMatchObject({ date: "2026-11-25", time: "20:00", weekday: "水" });
    expect(dateFields(IT_EVENT)).toEqual({ startDate: "2026-11-25", startTime: "20:00", endDate: "2026-11-25", endTime: "22:00" });
    expect(spacedDateTime("2026-11-25T20:00")).toBe("2026-11-25 20:00");
    expect(formatEventWhen(IT_EVENT)).toBe("2026年11月25日(水) 20:00 〜 22:00");
    expect(formatEventWhen({ startAt: "2026-11-25T20:00", endAt: null })).toBe("2026年11月25日(水) 20:00 〜");
  });
});

describe("行の直し", () => {
  const rules = [FIX_URL, FIX_LINE, FIX_EMAIL, FIX_PHONE, FIX_BANK];
  it("URL・地図・LINE・メール・電話番号・口座・PayPayの行を外し、欄・書き出し・理由を残す", () => {
    const text = ["はじめの行", "https://maps.app.goo.gl/abc", "LINEで連絡してください", "info@example.com まで", "03-1234-5678", "PayPayで払えます", "おわりの行"].join("\n");
    const r = applyFixRules("body", text, rules);
    expect(r.text).toBe("はじめの行\nおわりの行");
    expect(r.fixes).toHaveLength(5);
    expect(r.fixes[0]).toMatchObject({ field: "body", reason: expect.stringContaining("URL") });
  });

  it("「オンライン」や日付・時刻・郵便番号は外さない", () => {
    const text = "■場所：オンライン\n■日時：2026-11-25 20:00\n〒110-0005 東京都台東区";
    expect(applyFixRules("body", text, rules).fixes).toEqual([]);
  });

  it("書き出しは40字まで", () => {
    const long = `LINE ${"あ".repeat(60)}`;
    expect([...applyFixRules("body", long, rules).fixes[0]!.excerpt]).toHaveLength(41);
  });

  it("文字数は絵文字も1文字", () => {
    expect(lengthOf("🍻あ")).toBe(2);
  });
});

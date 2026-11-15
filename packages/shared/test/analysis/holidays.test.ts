// 祝日の判定（specs/022-algorithm-analysis research.md R4、T005）。
import { describe, expect, it } from "vitest";
import { isJapaneseHoliday } from "../../src";

describe("isJapaneseHoliday", () => {
  it("2026年の祝日・振替休日・国民の休日", () => {
    const days = [
      "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29",
      "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11",
      "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
    ];
    for (const d of days) expect(isJapaneseHoliday(d), d).toBe(true);
  });

  it("ふつうの平日・土日だけの日は祝日でない", () => {
    for (const d of ["2026-05-07", "2026-09-24", "2026-01-13", "2026-11-04", "2026-11-07"]) expect(isJapaneseHoliday(d), d).toBe(false);
  });

  it("春分と秋分の日（年で変わる）", () => {
    expect(isJapaneseHoliday("2025-03-20")).toBe(true);
    expect(isJapaneseHoliday("2025-09-23")).toBe(true);
    expect(isJapaneseHoliday("2027-03-21")).toBe(true);
    expect(isJapaneseHoliday("2027-09-23")).toBe(true);
    expect(isJapaneseHoliday("2025-03-21")).toBe(false);
  });

  it("振替休日（日曜の祝日の次の平日）", () => {
    expect(isJapaneseHoliday("2025-11-24")).toBe(true); // 勤労感謝の日（日）の振替
    expect(isJapaneseHoliday("2027-03-22")).toBe(true); // 春分の日（日）の振替
  });

  it("扱う年の外・形の違う文字列は false", () => {
    expect(isJapaneseHoliday("1999-01-01")).toBe(false);
    expect(isJapaneseHoliday("2100-01-01")).toBe(false);
    expect(isJapaneseHoliday("2026/01/01")).toBe(false);
  });
});

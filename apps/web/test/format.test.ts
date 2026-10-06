// 日時の表示（specs/005-auto-post contracts/ui-routes.md「日時の書き方」）
import { describe, expect, it } from "vitest";
import { formatRelativeJst, formatSlotTime } from "@/lib/format";

const jst = (s: string) => new Date(`${s.replace(" ", "T")}:00+09:00`);
const NOW = jst("2026-10-06 10:00");

describe("formatRelativeJst", () => {
  it("今日・明日を言葉にする", () => {
    expect(formatRelativeJst(jst("2026-10-06 12:00"), NOW)).toBe("今日 12:00");
    expect(formatRelativeJst(jst("2026-10-07 07:30"), NOW)).toBe("明日 7:30");
  });

  it("それより先・前は月日、年が違えば年から", () => {
    expect(formatRelativeJst(jst("2026-10-08 21:00"), NOW)).toBe("10月8日 21:00");
    expect(formatRelativeJst(jst("2026-10-05 09:05"), NOW)).toBe("10月5日 9:05");
    expect(formatRelativeJst(jst("2027-01-03 07:30"), NOW)).toBe("2027年1月3日 7:30");
  });

  it("日本時間の日付で比べる（UTC では前の日でも、日本時間で今日なら「今日」）", () => {
    expect(formatRelativeJst(new Date("2026-10-05T16:00:00Z"), NOW)).toBe("今日 1:00");
    expect(formatRelativeJst(jst("2026-10-06 23:59"), NOW)).toBe("今日 23:59");
    expect(formatRelativeJst(jst("2026-10-07 00:00"), NOW)).toBe("明日 0:00");
  });
});

describe("formatSlotTime", () => {
  it("先頭の0を落とす", () => {
    expect(formatSlotTime("07:30")).toBe("7:30");
    expect(formatSlotTime("21:00")).toBe("21:00");
    expect(formatSlotTime("00:05")).toBe("0:05");
  });
});

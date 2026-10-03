import { describe, expect, it } from "vitest";
import { hasGrowerAccess, isInTrial, trialEndsAt } from "../src/access";

describe("access", () => {
  it("無料体験の終了時刻は、日本時間の暦で1か月後の同じ時刻（research.md R14）", () => {
    // 2026-03-15 12:00 JST
    expect(trialEndsAt(new Date("2026-03-15T03:00:00.000Z")).toISOString()).toBe("2026-04-15T03:00:00.000Z");
    // 12月 → 翌年1月
    expect(trialEndsAt(new Date("2026-12-10T00:00:00.000Z")).toISOString()).toBe("2027-01-10T00:00:00.000Z");
  });

  it("1月31日の登録は、2月の最終日の同じ時刻まで", () => {
    // 2026-01-31 12:00 JST → 2026-02-28 12:00 JST
    expect(trialEndsAt(new Date("2026-01-31T03:00:00.000Z")).toISOString()).toBe("2026-02-28T03:00:00.000Z");
    // うるう年：2028-01-31 → 2028-02-29
    expect(trialEndsAt(new Date("2028-01-31T03:00:00.000Z")).toISOString()).toBe("2028-02-29T03:00:00.000Z");
  });

  it("日付は日本時間で数える（UTCでは前日でも、日本時間の日付から1か月）", () => {
    // 2026-01-31 23:30 UTC = 2026-02-01 08:30 JST → 2026-03-01 08:30 JST
    expect(trialEndsAt(new Date("2026-01-31T23:30:00.000Z")).toISOString()).toBe("2026-02-28T23:30:00.000Z");
  });

  it("無料体験中かどうか", () => {
    const created = new Date("2026-03-15T03:00:00.000Z");
    expect(isInTrial(created, new Date("2026-04-15T02:59:59.999Z"))).toBe(true);
    expect(isInTrial(created, new Date("2026-04-15T03:00:00.000Z"))).toBe(false);
  });

  it("grower機能：プラン2以上は常に使え、プラン1は無料体験中だけ使える（FR-024）", () => {
    const created = new Date("2026-03-15T03:00:00.000Z");
    const inTrial = new Date("2026-03-20T00:00:00.000Z");
    const afterTrial = new Date("2026-05-01T00:00:00.000Z");
    expect(hasGrowerAccess("auto-only", created, inTrial)).toBe(true);
    expect(hasGrowerAccess("auto-only", created, afterTrial)).toBe(false);
    for (const plan of ["auto-grower", "multi-account", "team"] as const) {
      expect(hasGrowerAccess(plan, created, afterTrial)).toBe(true);
    }
  });
});

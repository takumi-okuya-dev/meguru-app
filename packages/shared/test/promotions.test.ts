import { describe, expect, it } from "vitest";
import { isExpired, isTargetable, isValidYmd, jstToday, sortPromotions } from "../src/promotions";

describe("promotions", () => {
  it("日本時間の今日：UTC の 15:00 の前後で日付が変わる（research.md R6）", () => {
    expect(jstToday(new Date("2026-10-02T14:59:59.999Z"))).toBe("2026-10-02");
    expect(jstToday(new Date("2026-10-02T15:00:00.000Z"))).toBe("2026-10-03");
  });

  it("掲載期限の当日は宣伝の対象、翌日の0時（日本時間）から期限切れ（FR-008）", () => {
    const lastMoment = new Date("2026-10-03T14:59:59.999Z"); // 10/3 23:59:59 JST
    const nextDay = new Date("2026-10-03T15:00:00.000Z"); // 10/4 0:00 JST
    expect(isExpired("2026-10-03", lastMoment)).toBe(false);
    expect(isTargetable("active", "2026-10-03", lastMoment)).toBe(true);
    expect(isExpired("2026-10-03", nextDay)).toBe(true);
    expect(isTargetable("active", "2026-10-03", nextDay)).toBe(false);
    expect(isExpired(null, nextDay)).toBe(false);
  });

  it("状態が有効でなければ、期限内でも宣伝の対象ではない", () => {
    const now = new Date("2026-10-03T00:00:00.000Z");
    expect(isTargetable("paused", null, now)).toBe(false);
    expect(isTargetable("ended", "2026-12-31", now)).toBe(false);
  });

  it("並び順：宣伝の対象を先に、それぞれの中は優先度の降順・同じなら新しい順（FR-009）", () => {
    const now = new Date("2026-10-03T00:00:00.000Z");
    const t = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString();
    const items = [
      { id: "A", status: "active", validUntil: null, priority: 0, createdAt: t(1) },
      { id: "B", status: "active", validUntil: null, priority: 5, createdAt: t(2) },
      { id: "C", status: "paused", validUntil: null, priority: 9, createdAt: t(3) },
      { id: "D", status: "ended", validUntil: null, priority: 0, createdAt: t(4) },
      { id: "E", status: "active", validUntil: "2026-10-01", priority: 0, createdAt: t(5) },
      { id: "F", status: "active", validUntil: "2026-10-03", priority: 0, createdAt: t(6) },
    ] as const;
    expect(sortPromotions([...items], now).map((p) => p.id)).toEqual(["B", "F", "A", "C", "E", "D"]);
  });

  it("掲載期限の形：実在する YYYY-MM-DD だけを受け付ける", () => {
    expect(isValidYmd("2026-02-28")).toBe(true);
    expect(isValidYmd("2028-02-29")).toBe(true);
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("2026/10/03")).toBe(false);
  });
});

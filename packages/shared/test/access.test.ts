import { describe, expect, it } from "vitest";
import { hasGrowerAccess } from "../src/access";

describe("access", () => {
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

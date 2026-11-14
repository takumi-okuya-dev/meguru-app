// テスター招待の申し込み（specs/024-tester-invite-connect research.md R3、data-model.md 3）
import { describe, expect, it } from "vitest";
import {
  DECLINE_REASON_MAX,
  TESTER_APPLICATION_STATUSES,
  TESTER_APPLY_RATE,
  TESTER_REMOVAL_REASONS,
  TESTER_SLOT_CAPACITY_DEFAULT,
  normalizeThreadsUsername,
} from "../src/tester";

describe("normalizeThreadsUsername", () => {
  it("前後の空白と先頭の@を取り、小文字にそろえる", () => {
    expect(normalizeThreadsUsername("  @Shop_Tokyo ")).toBe("shop_tokyo");
    expect(normalizeThreadsUsername("cafe.minato")).toBe("cafe.minato");
    expect(normalizeThreadsUsername("a")).toBe("a");
    expect(normalizeThreadsUsername("a".repeat(30))).toBe("a".repeat(30));
  });

  it("使えない形は null", () => {
    for (const raw of ["", "   ", "@", "@@shop", "shop tokyo", "shop-tokyo", "ショップ", "a".repeat(31), "shop/tokyo"]) {
      expect(normalizeThreadsUsername(raw)).toBeNull();
    }
  });
});

describe("定数", () => {
  it("状態と理由と制限", () => {
    expect(TESTER_APPLICATION_STATUSES).toEqual(["pending", "invited", "connected", "declined", "withdrawn"]);
    expect(TESTER_REMOVAL_REASONS).toEqual(["account_deleted", "user_withdrawn", "withdrawn", "token_connected", "username_mismatch"]);
    expect(TESTER_APPLY_RATE).toEqual({ count: 5, windowMinutes: 10 });
    expect(DECLINE_REASON_MAX).toBe(200);
    expect(TESTER_SLOT_CAPACITY_DEFAULT).toBe(25);
  });
});

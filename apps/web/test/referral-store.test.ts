// 紹介リンクを開いたことをブラウザに覚える（specs/017-referral-links research.md R3、contracts/ui-routes.md 3）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearReferral, currentReferral, rememberReferral } from "@/lib/referral-store";

const CODE_A = `r_${"a".repeat(22)}`;
const CODE_B = `r_${"b".repeat(22)}`;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("紹介の文字列を覚える", () => {
  it("形に合うときだけ覚え、あとから開いた方で上書きする", () => {
    rememberReferral("nope");
    expect(currentReferral()).toBeNull();
    rememberReferral(CODE_A);
    expect(currentReferral()).toBe(CODE_A);
    rememberReferral(CODE_B);
    expect(currentReferral()).toBe(CODE_B);
  });

  it("30日を過ぎたら読まずに消す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    rememberReferral(CODE_A);
    vi.setSystemTime(new Date(Date.parse("2026-11-01T00:00:00Z") + 30 * DAY - 1000));
    expect(currentReferral()).toBe(CODE_A);
    vi.setSystemTime(new Date(Date.parse("2026-11-01T00:00:00Z") + 30 * DAY + 1000));
    expect(currentReferral()).toBeNull();
    expect(localStorage.getItem("tg.referral")).toBeNull();
  });

  it("消せる。壊れた値は読まない", () => {
    rememberReferral(CODE_A);
    clearReferral();
    expect(currentReferral()).toBeNull();
    localStorage.setItem("tg.referral", "{broken");
    expect(currentReferral()).toBeNull();
  });

  it("localStorage が使えない環境では何もしない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberReferral(CODE_A)).not.toThrow();
    expect(currentReferral()).toBeNull();
    expect(() => clearReferral()).not.toThrow();
  });
});

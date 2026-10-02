// 配色：既定はライト、ライト／ダーク／OSに合わせるを切り替えて保存する
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, getStoredTheme, resolveTheme, setTheme } from "@/lib/theme";

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? dark : !dark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("保存されていなければ、OSがダークでもライトになる（既定はライト）", () => {
    mockSystemDark(true);
    expect(getStoredTheme()).toBe("light");
    applyTheme(getStoredTheme());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ダークを選ぶと保存され、<html> に dark が付く", () => {
    setTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("「OSに合わせる」はOSの設定で決まる", () => {
    mockSystemDark(true);
    expect(resolveTheme("system")).toBe("dark");
    mockSystemDark(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("保存された値が壊れていればライトにする", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(getStoredTheme()).toBe("light");
  });
});

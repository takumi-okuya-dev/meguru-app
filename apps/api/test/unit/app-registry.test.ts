// アプリの機能と上限の登録（specs/meguru/029-threads-pattern1 contracts/platform-entry.md 5、T006）。
import { afterEach, describe, expect, it } from "vitest";
import {
  appFeatures,
  appLimits,
  isAppFeature,
  isValidAppLimit,
  registerAppFeatures,
  registerAppLimits,
  registeredApps,
  resetRegistry,
} from "../../src/platform/registry/registry";

afterEach(() => {
  resetRegistry();
});

describe("登録", () => {
  it("機能と上限を登録し、読める。登録したアプリの一覧に出る", () => {
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }]);
    registerAppLimits("sample", { people: { label: "人数", min: 1, max: 100, operatorValue: null } });
    expect(appFeatures("sample")).toEqual([{ key: "notes", label: "メモ" }]);
    expect(appLimits("sample").people?.max).toBe(100);
    expect(registeredApps()).toEqual(["sample"]);
  });

  it("同じアプリは1回だけ（2回目は何もしない）", () => {
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }]);
    registerAppFeatures("sample", [{ key: "other", label: "別" }]);
    expect(appFeatures("sample").map((f) => f.key)).toEqual(["notes"]);
  });

  it("登録していないアプリは空", () => {
    expect(appFeatures("none")).toEqual([]);
    expect(appLimits("none")).toEqual({});
  });

  it("名前と範囲を確かめる", () => {
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }]);
    registerAppLimits("sample", { people: { label: "人数", min: 1, max: 100, operatorValue: null } });
    expect([isAppFeature("sample", "notes"), isAppFeature("sample", "x"), isAppFeature("other", "notes")]).toEqual([true, false, false]);
    expect([0, 1, 100, 101, 1.5].map((v) => isValidAppLimit("sample", "people", v))).toEqual([false, true, true, false, false]);
    expect(isValidAppLimit("sample", "unknown", 1)).toBe(false);
  });
});

// アプリの機能と上限の登録（specs/meguru/029-threads-pattern1 contracts/platform-entry.md 5、T006）。
import { afterEach, describe, expect, it } from "vitest";
import {
  appFeatures,
  appLimits,
  requireFeatureSettingsApp,
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

  it("機能の名前は、ほかのアプリと重ねられない（ログインした人の features を1つの集合で持つため。T027）", () => {
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }]);
    expect(() => registerAppFeatures("other", [{ key: "notes", label: "別のメモ" }])).toThrow(/notes/);
    expect(registeredApps()).toEqual(["sample"]);
  });

  it("機能の名前は、同じアプリの中でも重ねられない", () => {
    expect(() => registerAppFeatures("sample", [{ key: "notes", label: "メモ" }, { key: "notes", label: "メモ2" }])).toThrow(/notes/);
    expect(registeredApps()).toEqual([]);
  });

  it("requireFeatureSettingsApp は、機能のON/OFFを持つと宣言したアプリ。宣言がなければ例外（共通はアプリの名前を知らない。T070）", () => {
    expect(() => requireFeatureSettingsApp()).toThrow(/登録されていません/);
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }], { switches: true });
    // ほかのアプリが機能を登録しても、ON/OFFの持ち主は変わらず、リクエストのたびの判断で止まらない（PR #105 のセルフレビュー）
    registerAppFeatures("other", [{ key: "photos", label: "写真" }]);
    expect(requireFeatureSettingsApp()).toBe("sample");
  });

  it("2つ目のアプリが機能のON/OFFを持とうとしたら、登録のときに止める", () => {
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }], { switches: true });
    expect(() => registerAppFeatures("other", [{ key: "photos", label: "写真" }], { switches: true })).toThrow(/sample/);
  });

  it("機能の名前の形が違えば、登録のときに止める（英小文字で始まり、英小文字・数字・_）", () => {
    expect(() => registerAppFeatures("sample", [{ key: "photoBook", label: "写真" }])).toThrow(/photoBook/);
    expect(() => registerAppFeatures("sample", [{ key: "2fa", label: "二段階" }])).toThrow(/2fa/);
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

// アプリの機能と上限の登録（specs/meguru/029-threads-pattern1 contracts/platform-entry.md 5、T006）。
import { afterEach, describe, expect, it } from "vitest";
import {
  appAccessMode,
  appFeatures,
  appLimits,
  grantedApps,
  registerAppAccess,
  requireFeatureSettingsApp,
  isAppFeature,
  operatorLimitsApp,
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

  it("運営の上限の画面が扱うアプリは、宣言したアプリ。2つ目の宣言と、名前の形の誤りは登録のときに止める", () => {
    expect(operatorLimitsApp()).toBeUndefined();
    registerAppLimits("sample", { people: { label: "人数", min: 1, max: 100, operatorValue: null } }, { operatorScreen: true });
    registerAppLimits("other", { photos: { label: "写真", min: 1, max: 10, operatorValue: null } });
    expect(operatorLimitsApp()).toBe("sample");
    expect(() => registerAppLimits("third", { x: { label: "x", min: 1, max: 1, operatorValue: null } }, { operatorScreen: true })).toThrow(/sample/);
    expect(() => registerAppLimits("bad", { dailyPosts: { label: "x", min: 1, max: 1, operatorValue: null } })).toThrow(/dailyPosts/);
  });

  it("2回目の登録で持ち主を宣言しても、黙って無視しない（PR #106 のセルフレビュー）", () => {
    registerAppLimits("sample", { people: { label: "人数", min: 1, max: 100, operatorValue: null } });
    registerAppLimits("sample", { people: { label: "人数", min: 1, max: 100, operatorValue: null } }, { operatorScreen: true });
    expect(operatorLimitsApp()).toBe("sample");
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }]);
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }], { switches: true });
    expect(requireFeatureSettingsApp()).toBe("sample");
  });

  it("機能の名前の形が違えば、登録のときに止める（DB の CHECK と同じ、英小文字と _ の1〜30文字）", () => {
    expect(() => registerAppFeatures("sample", [{ key: "photoBook", label: "写真" }])).toThrow(/photoBook/);
    expect(() => registerAppFeatures("sample", [{ key: "feature_v2", label: "二番目" }])).toThrow(/feature_v2/);
    expect(() => registerAppFeatures("sample", [{ key: "a".repeat(31), label: "長い" }])).toThrow(/a{31}/);
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

describe("アプリの利用の決まり（specs/meguru/030-app-access FR-001）", () => {
  it("登録しないアプリは open。granted で登録したアプリは登録の順に grantedApps に出て、登録したアプリの一覧にも出る", () => {
    expect(appAccessMode("sample")).toBe("open");
    registerAppFeatures("sample", [{ key: "notes", label: "メモ" }]);
    registerAppAccess("gated-b", "granted");
    registerAppAccess("open-app", "open");
    registerAppAccess("gated-a", "granted");
    expect([appAccessMode("gated-b"), appAccessMode("open-app"), appAccessMode("sample")]).toEqual(["granted", "open", "open"]);
    expect(grantedApps()).toEqual(["gated-b", "gated-a"]);
    expect(registeredApps()).toEqual(["sample", "gated-b", "open-app", "gated-a"]);
  });

  it("同じ決まりの2回目は何もしない。違う決まりと、名前の形の誤りは登録のときに止める", () => {
    registerAppAccess("sample", "granted");
    registerAppAccess("sample", "granted");
    expect(grantedApps()).toEqual(["sample"]);
    expect(() => registerAppAccess("sample", "open")).toThrow(/sample/);
    expect(() => registerAppAccess("Sample", "granted")).toThrow(/Sample/);
    expect(() => registerAppAccess("a".repeat(32), "granted")).toThrow(/a{32}/);
    expect(() => registerAppAccess("demo_x", "granted")).toThrow(/demo_x/);
  });

  it("登録を消すと、決まりも消える（テスト用）", () => {
    registerAppAccess("sample", "granted");
    resetRegistry();
    expect([appAccessMode("sample"), grantedApps()]).toEqual(["open", []]);
  });
});

// アプリが共通に登録する、機能のまとまりと上限の名前（specs/meguru/029-threads-pattern1 research.md R7、contracts/platform-entry.md 5）。
// 名前・表示名・範囲はアプリが決め、組み立て（app.ts）で登録する。共通のコードにはアプリの名前を書かない。
// アプリの利用の決まり（だれでも使える・運営者が開いた人だけ）も、ここで登録する（specs/meguru/030-app-access FR-001）。
import type { AppAccessMode } from "@meguru/shared";

/** 機能のまとまりの定義。 */
export type AppFeatureDef = {
  /** 名前（英小文字と _。DBの feature の列） */
  key: string;
  /** 運営の画面に出す名前 */
  label: string;
  /** 運営の画面に出す説明（なければ出さない） */
  description?: string;
};

/** 上限の定義。 */
export type AppLimitDef = {
  /** 運営の画面に出す名前 */
  label: string;
  /** 運営者が決められる値の範囲 */
  min: number;
  max: number;
  /** 運営者に当てる値（null は上限なし） */
  operatorValue: number | null;
  /** 一覧に出す短い名前（例：アカウント・投稿。「アカウント5件」「投稿は既定値」のように出す） */
  shortLabel?: string;
  /** 既定値の欄で、名前の後ろに括弧で添える文（例：1アカウント） */
  note?: string;
  /** この上限が、アプリから伝えられた利用の数（app_usage の数）を数えるものか（見つかった人に「アカウント3件」と出す） */
  countsUsage?: boolean;
};

const features = new Map<string, readonly AppFeatureDef[]>();
/** 機能のON/OFF（運営の画面と、ログインした人の features）を持つアプリ。登録のときにアプリが宣言する */
let switchesOwner: string | undefined;
/** 機能・上限の名前の形（英小文字と _ の1〜30文字。機能の表の CHECK（platform/schema.ts）と、@meguru/shared の appKeySchema に合わせる） */
const FEATURE_KEY_RE = /^[a-z_]{1,30}$/;
const limits = new Map<string, Readonly<Record<string, AppLimitDef>>>();
/** 運営の上限の画面が扱うアプリ。登録のときにアプリが宣言する（機能のON/OFFと同じ決まり） */
let limitsOwner: string | undefined;
/** アプリの利用の決まり（登録の順。登録しないアプリは open） */
const accessModes = new Map<string, AppAccessMode>();
/**
 * 利用の許可の表に書けるアプリの名前の形（英小文字で始まり、英小文字・数字・- の31文字まで。アプリの番号の形で、機能の ON/OFF の表の
 * app の列と、許可の表の CHECK（platform/schema.ts）に合わせる。specs/meguru/030-app-access plan.md「表」）
 */
const ACCESS_APP_RE = /^[a-z][a-z0-9-]{0,30}$/;

/**
 * アプリの機能のまとまりを登録する。同じアプリは1回だけ（2回目からは何もしない）。
 * 機能のON/OFF（運営の画面と、ログインした人の features）を持つアプリは opts.switches で宣言する。運営の画面をアプリごとに
 * 分けるまで、持てるのは1つのアプリだけ（2つ目の宣言は起動のときに止める。リクエストのたびには判断しない。PR #105 のセルフレビュー）。
 * @param app - アプリの番号（例：threads）
 * @param defs - 機能のまとまり（並びは運営の画面の順）
 * @param opts - switches：このアプリが機能のON/OFFを持つ
 * @throws Error 名前の形が違う・重なる、または2つ目のアプリが機能のON/OFFを持とうとしたとき
 */
export function registerAppFeatures(app: string, defs: readonly AppFeatureDef[], opts: { switches?: boolean } = {}): void {
  // 持ち主の宣言の重なりは、2回目の登録でも確かめる（2回目に宣言を足しても黙って無視しない。PR #106 のセルフレビュー）
  if (opts.switches && switchesOwner && switchesOwner !== app) {
    throw new Error(`機能のON/OFFは、アプリ「${switchesOwner}」がもう持っています（運営の画面をアプリごとに分けるまで、1つだけ）`);
  }
  if (features.has(app)) {
    if (opts.switches) switchesOwner = app;
    return;
  }
  const bad = defs.find((d) => !FEATURE_KEY_RE.test(d.key));
  if (bad) throw new Error(`機能の名前「${bad.key}」の形が違います（英小文字と _ の1〜30文字だけ）`);
  // 機能の名前は重ねない（同じアプリの中でも、アプリをまたいでも。ログインした人の features は1つの集合で持つため。specs/meguru/029 tasks.md T027）
  const keys = defs.map((d) => d.key);
  const inside = keys.find((k, i) => keys.indexOf(k) !== i);
  if (inside) throw new Error(`機能の名前「${inside}」が、アプリ「${app}」の中で重なっています`);
  for (const [other, list] of features) {
    const dup = defs.find((d) => list.some((o) => o.key === d.key));
    if (dup) throw new Error(`機能の名前「${dup.key}」は、アプリ「${other}」がもう登録しています`);
  }
  features.set(app, defs);
  if (opts.switches) switchesOwner = app;
}

/**
 * 機能のON/OFFの運営の画面と、ログインした人の features が扱うアプリ（registerAppFeatures で switches を宣言したアプリ）。
 * @returns アプリの番号
 * @throws Error 宣言したアプリがないとき（組み立ての登録漏れ。黙って全部ONにしないため）
 */
export function requireFeatureSettingsApp(): string {
  if (!switchesOwner) throw new Error("機能のON/OFFを持つアプリが登録されていません（組み立てで registerAppFeatures(…, { switches: true }) を呼んでください）");
  return switchesOwner;
}

/**
 * 機能のON/OFFを持つアプリと、その機能の名前（登録の順）。
 * @returns アプリの番号と名前
 * @throws Error 宣言したアプリがないとき
 */
export function featureSettings(): { app: string; keys: string[] } {
  const app = requireFeatureSettingsApp();
  return { app, keys: (features.get(app) ?? []).map((d) => d.key) };
}

/**
 * アプリの上限を登録する。同じアプリは1回だけ。
 * @param app - アプリの番号
 * @param defs - 名前ごとの上限の定義
 * @param opts - operatorScreen：このアプリの上限を運営の上限の画面で扱う（1つのアプリだけ）
 * @throws Error 名前の形が違う、または2つ目のアプリが運営の上限の画面を持とうとしたとき
 */
export function registerAppLimits(
  app: string,
  defs: Readonly<Record<string, AppLimitDef>>,
  opts: { operatorScreen?: boolean } = {},
): void {
  if (opts.operatorScreen && limitsOwner && limitsOwner !== app) {
    throw new Error(`運営の上限の画面は、アプリ「${limitsOwner}」がもう持っています（画面をアプリごとに分けるまで、1つだけ）`);
  }
  if (limits.has(app)) {
    if (opts.operatorScreen) limitsOwner = app;
    return;
  }
  const bad = Object.keys(defs).find((k) => !FEATURE_KEY_RE.test(k));
  if (bad) throw new Error(`上限の名前「${bad}」の形が違います（英小文字と _ の1〜30文字だけ）`);
  limits.set(app, defs);
  if (opts.operatorScreen) limitsOwner = app;
}

/**
 * アプリの利用の決まりを登録する（specs/meguru/030-app-access FR-001）。登録しないアプリは open（だれでも使える）。
 * 同じアプリを違う決まりで2回登録したら、起動のときに止める（黙って片方を使わない）。
 * @param app - アプリの番号
 * @param mode - open：だれでも使える。granted：運営者・人ごとの許可・閉じていないテストのグループの許可がある人だけ
 * @throws Error 名前の形が違う、または同じアプリを違う決まりで登録しようとしたとき
 */
export function registerAppAccess(app: string, mode: AppAccessMode): void {
  if (!ACCESS_APP_RE.test(app)) throw new Error(`アプリの名前「${app}」の形が違います（英小文字で始まり、英小文字・数字・- の31文字まで）`);
  const before = accessModes.get(app);
  if (before && before !== mode) throw new Error(`アプリ「${app}」の利用の決まりは、もう「${before}」で登録しています`);
  accessModes.set(app, mode);
}

/**
 * アプリの利用の決まり（登録していなければ open）。
 * @param app - アプリの番号
 * @returns open か granted
 */
export function appAccessMode(app: string): AppAccessMode {
  return accessModes.get(app) ?? "open";
}

/**
 * 「運営者が開いた人だけ」（granted）で登録したアプリ（登録の順）。
 * @returns アプリの番号
 */
export function grantedApps(): string[] {
  return [...accessModes].filter(([, mode]) => mode === "granted").map(([app]) => app);
}

/**
 * 運営の上限の画面が扱うアプリ（registerAppLimits で operatorScreen を宣言したアプリ）。
 * @returns アプリの番号（宣言がなければ undefined）
 */
export function operatorLimitsApp(): string | undefined {
  return limitsOwner;
}

/**
 * アプリの機能のまとまりの定義（登録していなければ空）。
 * @param app - アプリの番号
 * @returns 機能のまとまり
 */
export function appFeatures(app: string): readonly AppFeatureDef[] {
  return features.get(app) ?? [];
}

/**
 * アプリの上限の定義（登録していなければ空）。
 * @param app - アプリの番号
 * @returns 名前ごとの上限の定義
 */
export function appLimits(app: string): Readonly<Record<string, AppLimitDef>> {
  return limits.get(app) ?? {};
}

/**
 * 機能・上限・利用の決まりのどれかを登録したアプリの番号（登録した順）。
 * @returns アプリの番号
 */
export function registeredApps(): string[] {
  return [...new Set([...features.keys(), ...limits.keys(), ...accessModes.keys()])];
}

/**
 * 登録した機能の名前か。
 * @param app - アプリの番号
 * @param key - 名前
 * @returns 登録していれば true
 */
export function isAppFeature(app: string, key: string): boolean {
  return appFeatures(app).some((f) => f.key === key);
}

/**
 * 上限の値が、登録した範囲の中か。
 * @param app - アプリの番号
 * @param key - 名前
 * @param value - 値
 * @returns 範囲の中なら true（登録していない名前は false）
 */
export function isValidAppLimit(app: string, key: string, value: number): boolean {
  const def = appLimits(app)[key];
  return Boolean(def) && Number.isInteger(value) && value >= def!.min && value <= def!.max;
}

/** 登録をすべて消す（テスト用）。 */
export function resetRegistry(): void {
  features.clear();
  limits.clear();
  accessModes.clear();
  switchesOwner = undefined;
  limitsOwner = undefined;
}

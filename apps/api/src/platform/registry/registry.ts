// アプリが共通に登録する、機能のまとまりと上限の名前（specs/meguru/029-threads-pattern1 research.md R7、contracts/platform-entry.md 5）。
// 名前・表示名・範囲はアプリが決め、組み立て（app.ts）で登録する。共通のコードにはアプリの名前を書かない。

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
};

const features = new Map<string, readonly AppFeatureDef[]>();
const limits = new Map<string, Readonly<Record<string, AppLimitDef>>>();

/**
 * アプリの機能のまとまりを登録する。同じアプリは1回だけ（2回目からは何もしない）。
 * @param app - アプリの番号（例：threads）
 * @param defs - 機能のまとまり（並びは運営の画面の順）
 */
export function registerAppFeatures(app: string, defs: readonly AppFeatureDef[]): void {
  if (features.has(app)) return;
  // 機能の名前はアプリをまたいで重ねない（ログインした人の features は1つの集合で持つため。specs/meguru/029 tasks.md T027）
  for (const [other, list] of features) {
    const dup = defs.find((d) => list.some((o) => o.key === d.key));
    if (dup) throw new Error(`機能の名前「${dup.key}」は、アプリ「${other}」がもう登録しています`);
  }
  features.set(app, defs);
}

/**
 * 機能のON/OFFの運営の画面と、ログインした人の features が扱うアプリ（機能を登録した最初のアプリ）。
 * 運営の画面を登録の一覧で出す形にするまで（PR4 の T069・T070）、ON/OFFは1つのアプリのものとして扱う。
 * @returns アプリの番号（登録がなければ undefined）
 */
export function featureSettingsApp(): string | undefined {
  return [...features.entries()].find(([, list]) => list.length > 0)?.[0];
}

/**
 * アプリの上限を登録する。同じアプリは1回だけ。
 * @param app - アプリの番号
 * @param defs - 名前ごとの上限の定義
 */
export function registerAppLimits(app: string, defs: Readonly<Record<string, AppLimitDef>>): void {
  if (limits.has(app)) return;
  limits.set(app, defs);
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
 * 機能か上限を登録したアプリの番号（登録した順）。
 * @returns アプリの番号
 */
export function registeredApps(): string[] {
  return [...new Set([...features.keys(), ...limits.keys()])];
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
}

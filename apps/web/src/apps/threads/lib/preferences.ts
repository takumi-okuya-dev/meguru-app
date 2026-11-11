// 端末に覚える表示の好み（specs/014-strategy-guidance research.md R15）。
// localStorage が使えない（プライベートブラウズ・保存の禁止など）ときは、例外を出さずに初めの値で表示する。

/** 好みのキー。すべて「threads-grower:」で始める。 */
export type PreferenceKey = `threads-grower:${string}`;

/**
 * 覚えた好みを読む。
 * @param key - キー
 * @param fallback - 覚えていない・読めないときの値（この型で読む）
 * @returns 覚えた値、なければ fallback
 */
export function readPreference(key: PreferenceKey, fallback: boolean): boolean;
export function readPreference(key: PreferenceKey, fallback: string): string;
export function readPreference(key: PreferenceKey, fallback: string | boolean): string | boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return typeof fallback === "boolean" ? raw === "true" : raw;
  } catch {
    return fallback;
  }
}

/**
 * 好みを覚える。書けなくても、画面の動きは止めない。
 * @param key - キー
 * @param value - 覚える値
 */
export function writePreference(key: PreferenceKey, value: string | boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 覚えられないだけで、今の表示はそのまま使える
  }
}

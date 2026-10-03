// テキストの判定（specs/002-strategy-profile research.md R2・R5・R8）。

/**
 * 文字数を Unicode のコードポイントの数で数える。DB の char_length と一致する（research.md R2）。
 * @param s - 数える文字列
 * @returns 文字数（絵文字1つは1文字）
 */
export function countChars(s: string): number {
  return [...s].length;
}

/**
 * 前後の空白・改行を除いて空になるかを確かめる。空なら「未入力」として扱う（research.md R2）。
 * @param s - 確かめる文字列
 * @returns 空なら true
 */
export function isBlank(s: string): boolean {
  return s.trim() === "";
}

/**
 * キーワードの重複判定用に正規化する：NFKC → 前後の空白を除く → 小文字（research.md R5）。
 * @param s - キーワード
 * @returns 正規化したキーワード
 */
export function normalizeKeyword(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

/**
 * http・https の URL かを確かめる。javascript: などは受け付けない（research.md R8）。
 * @param s - 確かめる文字列
 * @returns http・https の URL なら true
 */
export function isHttpUrl(s: string): boolean {
  // URL クラスに頼らず判定する（packages/shared は DOM・Workers の型を持たない）。
  // スキームが http・https で、ホスト名があり、空白を含まないこと
  return /^https?:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/i.test(s);
}

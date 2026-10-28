// NGワードの照合（specs/004-review-approval FR-015・FR-016、research.md R4）。
// WebのラベルとAPIの承認のチェックで同じ判定を使う。正規表現は使わない（ユーザーの入力に記号が含まれても誤動作しない）。
import { normalizeForMatch, toOriginalRange } from "./normalize";

/**
 * 照合に使うNGワード（ng_words の行）。
 *
 * `normalized` は登録した時点の値で、DBの重複の判定（`(account_id, normalized)` の一意索引）に使う。
 * **照合には使わない** — 照合の正規化を変えると保存値が古くなり、同じ文字どうしでも当たらなくなるため
 * （PR #20 のCodexレビュー）。照合のたびに `word` から正規化し直す。
 */
export type NgWordForMatch = { word: string; normalized?: string };

/** NGワードの照合の結果。ranges は元の本文の [開始, 終了)（UTF-16の位置）。 */
export type NgWordHit = { word: string; ranges: [number, number][] };

/**
 * NGワードの登録・重複の判定に使う値にする（前後の空白を除いて、照合用に正規化する）。
 * @param word - 入力された言葉
 * @returns 正規化した値
 */
export function normalizeNgWord(word: string): string {
  return normalizeForMatch(word.trim()).normalized;
}

/**
 * 本文に含まれるNGワードを探す。言葉の途中に含まれる場合も当たる。
 * @param body - 下書きの本文
 * @param ngWords - そのAccountのNGワード
 * @returns 当たったNGワードと、元の本文での範囲（ngWords の順）
 */
export function findNgWords(body: string, ngWords: NgWordForMatch[]): NgWordHit[] {
  if (ngWords.length === 0) return [];
  const { normalized, toOriginal } = normalizeForMatch(body);
  const hits: NgWordHit[] = [];
  for (const ng of ngWords) {
    // 保存された normalized ではなく、word から正規化し直す（保存値は古いことがある）
    const needle = normalizeNgWord(ng.word);
    if (needle === "") continue;
    const ranges: [number, number][] = [];
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(needle, from);
      if (at < 0) break;
      ranges.push(toOriginalRange(toOriginal, at, at + needle.length));
      from = at + needle.length;
    }
    if (ranges.length > 0) hits.push({ word: ng.word, ranges });
  }
  return hits;
}

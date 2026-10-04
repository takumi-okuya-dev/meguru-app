// 照合用の正規化（specs/004-review-approval research.md R4）。
// NGワード・規約に注意・類似度で同じ正規化を使い、当たった範囲を元の本文の位置に戻せるようにする。

/**
 * 1文字（コードポイント）ずつ NFKC → 小文字にする。全角／半角・大文字／小文字の違いをそろえ、ひらがなとカタカナは変えない。
 * @param text - 元の文字列
 * @returns normalized：正規化した文字列、toOriginal：正規化した文字列の各位置（UTF-16）が元のどの位置から来たか。
 *   最後に元の長さを1つ足す（範囲の終わりを戻すため）
 */
export function normalizeForMatch(text: string): { normalized: string; toOriginal: number[] } {
  let normalized = "";
  const toOriginal: number[] = [];
  let pos = 0;
  for (const ch of text) {
    // 1文字ずつ正規化すれば、NFKCで長さが変わる文字（「㌔」→「キロ」など）でも位置の対応が取れる
    const n = ch.normalize("NFKC").toLowerCase();
    for (let i = 0; i < n.length; i++) toOriginal.push(pos);
    normalized += n;
    pos += ch.length;
  }
  toOriginal.push(pos);
  return { normalized, toOriginal };
}

/**
 * 正規化した文字列の範囲 [start, end) を、元の文字列の範囲に戻す。
 * @param toOriginal - normalizeForMatch の toOriginal
 * @param start - 正規化した文字列での開始位置
 * @param end - 正規化した文字列での終了位置（含まない）
 * @returns 元の文字列での [開始, 終了)
 */
export function toOriginalRange(toOriginal: number[], start: number, end: number): [number, number] {
  const from = toOriginal[start]!;
  // 終わりは「最後の文字の次の元の文字の位置」。1文字が複数に広がった途中で終わる場合も、その元の文字を含める
  const last = toOriginal[end - 1]!;
  let to = toOriginal[end]!;
  if (to === last) {
    let i = end;
    while (i < toOriginal.length - 1 && toOriginal[i] === last) i++;
    to = toOriginal[i]!;
  }
  return [from, to];
}

// 照合用の正規化（specs/004-review-approval research.md R4）。
// NGワード・規約に注意・類似度で同じ正規化を使い、当たった範囲を元の本文の位置に戻せるようにする。

/** 前の文字と合わせて正規化する文字：結合文字（濁点など）と、半角の濁点・半濁点（ﾞ・ﾟ）。 */
const JOINS_PREVIOUS = /^[\p{M}\uFF9E\uFF9F]$/u;

/**
 * 照合では無視する「見えない文字」。
 *
 * (1) 書式文字 `\p{Cf}`（U+00AD・U+200B〜U+200F・U+2060〜U+2064・U+FEFF など）。
 * (2) 字形を変えずに残る、既定で無視される印：異体字セレクタ U+FE00〜U+FE0F と
 *     U+E0100〜U+E01EF、結合書記素接合子 U+034F、モンゴル文字の自由異体字選択符
 *     U+180B〜U+180F、U+17B4・U+17B5。これらは `\p{M}` なので JOINS_PREVIOUS が
 *     前の文字にまとめてしまい、NFKC でも消えない。つまり `\p{Cf}` を落とすだけでは
 *     「絶」+U+FE0F+「対」が「絶対」に一致せず、抜け道が残る（セキュリティ監査 run-1）。
 *
 * 制御文字 `\p{Cc}` は含めない：policy.ts の NEAR が `[^。\n]{0,15}` で改行を文の境目に
 * 使っているため、ここで消すと文をまたいだ誤検知が増える。
 */
const IGNORED_FOR_MATCH =
  /^(?:\p{Cf}|[\u034F\u17B4\u17B5\u180B-\u180F\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}])$/u;

/**
 * 1文字ずつ NFKC → 小文字にする。全角／半角・大文字／小文字の違いをそろえ、ひらがなとカタカナは変えない。
 * 後ろに結合文字や半角の濁点・半濁点が続く文字は、まとめて正規化する（「ｶﾞ」→「ガ」。1文字ずつだと
 * 「カ」＋結合濁点になり、全角の「ガ」と一致しない。PR #5 のCodexレビュー）。
 * @param text - 元の文字列
 * @returns normalized：正規化した文字列、toOriginal：正規化した文字列の各位置（UTF-16）が元のどの位置から来たか。
 *   最後に元の長さを1つ足す（範囲の終わりを戻すため）
 */
export function normalizeForMatch(text: string): { normalized: string; toOriginal: number[] } {
  let normalized = "";
  const toOriginal: number[] = [];
  const chars = [...text];
  let pos = 0;
  let i = 0;
  while (i < chars.length) {
    // 見えない文字は照合用の文字列に入れない（元の位置だけ進める）。
    // 「絶」+U+200B+「対」のような挟み込みで、NGワードと規約に注意の照合をすり抜けさせない
    if (IGNORED_FOR_MATCH.test(chars[i]!)) {
      pos += chars[i]!.length;
      i++;
      continue;
    }
    // 1文字（と、それに続く結合文字）ずつ正規化すれば、NFKCで長さが変わる文字（「㌔」→「キロ」など）でも位置の対応が取れる
    const start = pos;
    let unit = chars[i]!;
    pos += chars[i]!.length;
    i++;
    // 後ろに続く結合文字（濁点など）はまとめる。間に挟まれた見えない文字は読み飛ばす
    // （「ｶ」+U+200B+「ﾞ」も「ガ」にする。見えない文字でまとめる単位を割る抜け道をふさぐ）
    for (;;) {
      if (i < chars.length && IGNORED_FOR_MATCH.test(chars[i]!)) {
        pos += chars[i]!.length;
        i++;
        continue;
      }
      if (i < chars.length && JOINS_PREVIOUS.test(chars[i]!)) {
        unit += chars[i]!;
        pos += chars[i]!.length;
        i++;
        continue;
      }
      break;
    }
    const n = unit.normalize("NFKC").toLowerCase();
    // 落とした見えない文字は、この単位の範囲に含めたまま（強調する範囲が元の本文とずれない）
    for (let k = 0; k < n.length; k++) toOriginal.push(start);
    normalized += n;
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
export function toOriginalRange(
  toOriginal: number[],
  start: number,
  end: number,
): [number, number] {
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

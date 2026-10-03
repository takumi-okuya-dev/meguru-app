// Threadsの1投稿の長さとリンクの数（specs/003-prompt-bulk-register research.md R4）。
// 公式ドキュメント（https://developers.facebook.com/docs/threads/posts/、2026-10-03に確認）：
// 「Text posts are limited to 500 characters」「Emojis are counted as the number of UTF-8 bytes」「links … 5 or less」

/** Threadsの1投稿の上限（Threadsの数え方で500）。 */
export const THREADS_TEXT_LIMIT = 500;
/** Threadsの1投稿のリンクの上限。 */
export const THREADS_LINK_LIMIT = 5;

// キーキャップ（1️⃣・#️⃣など）は U+20E3 で結合する。Extended_Pictographic を含まないので別に見る
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
// リンクの始まり。日本語の本文では、URLが句読点や次のURLと空白なしで続くことがあるので、終わりではなく始まりを数える。
// 「https://www.」の www. は数えない（直前が「/」・英数字・「.」の www. は除く）
const LINK_START = /https?:\/\/|(?<![/\w.])www\./gi;

let segmenter: Intl.Segmenter | undefined;

function utf8Bytes(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Threadsの数え方で長さを数える。1文字を1として数え、絵文字だけはUTF-8のバイト数で数える。
 * 結合した絵文字（ZWJ・異体字セレクタ・国旗）は、まとめてバイト数で数える（多めに数える側に倒す）。
 * @param text - 本文
 * @returns Threadsの数え方での長さ
 */
export function threadsLength(text: string): number {
  segmenter ??= new Intl.Segmenter("ja", { granularity: "grapheme" });
  let length = 0;
  for (const { segment } of segmenter.segment(text)) {
    length += EMOJI.test(segment) ? utf8Bytes(segment) : [...segment].length;
  }
  return length;
}

/**
 * 本文の中のリンク（http://・https://・www.で始まる部分）の数を、始まりの数で数える。
 * @param text - 本文
 * @returns リンクの数
 */
export function countLinks(text: string): number {
  return text.match(LINK_START)?.length ?? 0;
}

/**
 * Threadsの上限（500・リンク5個）を超えているかを確かめる。
 * @param text - 本文
 * @returns 超えていれば true
 */
export function isOverThreadsLimit(text: string): boolean {
  return threadsLength(text) > THREADS_TEXT_LIMIT || countLinks(text) > THREADS_LINK_LIMIT;
}

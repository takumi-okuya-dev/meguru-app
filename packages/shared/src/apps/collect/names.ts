// 集金管理の名前の扱い（specs/collect/001-event-day-collection research.md R9、FR-024・FR-026・FR-027）。
// APIも画面も同じ関数を使う（モバイルの画面からも同じ判定にする）。

/** カタカナ（ァ〜ヶ）をひらがなに直す差。 */
const KATAKANA_TO_HIRAGANA = 0x60;

/**
 * 名前を見比べるための形にする：NFKC（全角と半角をそろえる）→ カタカナをひらがなに → 空白を除く → 小文字。
 * 半角カナで全角の空白をはさんだ「ﾔﾏﾀﾞ タロウ」と「やまだたろう」は同じ形になる。同じ名前の知らせ・前回の参加者・受付の絞り込みに使う。
 * @param name - 名前かふりがな
 * @returns 見比べるための形（空なら空）
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - KATAKANA_TO_HIRAGANA))
    .replace(/\s+/gu, "")
    .toLowerCase();
}

/** メールアドレス（英数字の部分だけ。前に区切りなしで名前が続いても、名前まで消さない）。 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 電話番号（0から始まる10〜11桁・+81。区切りのハイフン・空白・かっこを許す）。 */
const PHONE = /(?:\+81|0)\d{1,4}[-\s(]*\d{1,4}[-\s)]*\d{3,4}/g;
/** 行の頭の番号や記号（「1.」「2)」「①」「・」「-」「No.3」など）。 */
const LEADING_MARK = /^(?:no\.?\s*\d+|#?\d+\s*[.)、:．]?|[①-⑳]|[・\-*•●○◯■□◆◇▪>]+)\s*/iu;
/** 敬称（後ろが空白か行の終わりのときだけ。「さんぺい」などの名前の一部は消さない）。 */
const HONORIFIC = /\s*(?:様|さま|さん|殿)(?=\s|$)/gu;
/** 行の終わりに残った区切り。 */
const TRAILING_SEPARATORS = /[\s,、/|｜:：<＜(（[［]+$/u;
/** メールアドレス・電話番号を除いたあとに残った、空のかっこ。 */
const EMPTY_BRACKETS = /[(（<＜[［]\s*[)）>＞\]］]/gu;

/**
 * 貼った文の1行から、名前だけを取り出す（FR-026）：行の頭の番号や記号・敬称・メールアドレス・電話番号・前後の空白を除く。
 * 全角の英数字や半角のカナは NFKC でそろえる。取り除いたあとに何も残らなければ空を返す（その行は足さない）。
 * @param line - 貼った文の1行
 * @returns 名前（なければ空）
 */
export function cleanPastedLine(line: string): string {
  let s = line.normalize("NFKC").replace(EMAIL, " ").replace(PHONE, " ").trim();
  // 「1. ・松本」のように記号が重なっても取れるよう、変わらなくなるまで頭を削る（多くても数回）
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEADING_MARK, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(EMPTY_BRACKETS, " ").replace(HONORIFIC, "").replace(TRAILING_SEPARATORS, "").replace(/\s+/gu, " ").trim();
}

/** 名前ではなさそうな行の印（日付・申込・チケット・金額など）。 */
const NON_NAME_PATTERNS: readonly RegExp[] = [
  /\d{1,4}\s*[/／年月]\s*\d{1,2}/u,
  /申込|申し込み|チケット|参加費|合計|枚|件|受付|イベント|開催|会場|定員/u,
  /\d[\d,]*\s*円|[¥￥]\s*\d/u,
  /\d{1,2}:\d{2}/,
];

/**
 * 貼った文の行のうち、名前ではなさそうな行か（足す前の確かめの一覧で、最初から外しておく。主催者は戻せる）。
 * 日付・時刻・金額・「申込」「チケット」などの言葉を含む行、文字のない行、名前にしては長すぎる行（50文字を超える）を真にする。
 * @param line - 行（cleanPastedLine の前でも後でもよい）
 * @returns 名前ではなさそうなら true
 */
export function looksLikeNonName(line: string): boolean {
  const s = line.normalize("NFKC").trim();
  if (s === "") return true;
  if ([...s].length > 50) return true;
  if (!/[\p{L}]/u.test(s)) return true;
  return NON_NAME_PATTERNS.some((p) => p.test(s));
}

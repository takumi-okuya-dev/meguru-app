// 人物メモの名前と質問文の比べ方（specs/people/001-people-memo research.md R6・R9）。
// APIも画面も同じ関数を使う（モバイルの画面からも同じ判定にする）。

/** カタカナ（ァ〜ヶ）をひらがなに直す差。 */
const KATAKANA_TO_HIRAGANA = 0x60;
/** 見えない文字（書式の文字 \p{Cf}：ゼロ幅の空白・つなぎの文字など）と異体字セレクタ。 */
const INVISIBLE = /[\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu;
/** 記号を除いた比べ方で除くもの：句読点・記号・絵文字・囲みの記号。 */
const LOOSE_DROP = /[\p{P}\p{S}\p{Extended_Pictographic}\p{Me}]/gu;

/**
 * 名前を見比べるための形にする：NFKC（全角と半角をそろえる）→ 見えない文字を除く → カタカナをひらがなに → 空白を除く → 小文字。
 * 「ﾀﾛｳ ﾔﾏﾀﾞ」（半角のカナと全角の空白）と「たろうやまだ」は同じ形になる。絵文字は残る（「たろう🌸」と「たろう🌻」は違う）。
 * 集金管理の nameKey と同じ決め方に、見えない文字を除くことを足したもの（アプリ同士のコードは使わないので、人物メモの中に持つ。R9）。
 * @param name - 名前（LINE名・本名・相談先の名前）
 * @returns 見比べるための形（空なら空）
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - KATAKANA_TO_HIRAGANA))
    .replace(/\s+/gu, "")
    .toLowerCase();
}

/**
 * 記号を除いた比べ方の形にする：nameKey のあと、絵文字・記号・句読点を除く。同じ人の候補を出すときだけ使う（つなぐのは作り手。R9）。
 * 「たろう🌸」と「たろう🌻」は同じ形になる。2文字未満になったら使わない（記号だけの名前で、関係のない人が候補に並ばないように）。
 * @param name - 名前
 * @returns 見比べるための形。2文字未満なら null
 */
export function looseKey(name: string): string | null {
  const key = nameKey(name).replace(LOOSE_DROP, "");
  return [...key].length >= 2 ? key : null;
}

/**
 * 質問文・選択肢の文を覚えるための鍵にする：NFKC → 前後の空白を外す → 続く空白（全角を含む）を1つの半角空白に。
 * 似ている文を推し量って当てることはしない（「あなたのLINE名を教えて下さい」と「LINE名を教えてください」は別の鍵。R6）。
 * @param text - 質問文か選択肢の文
 * @returns 鍵
 */
export function questionKey(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

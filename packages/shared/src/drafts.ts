// 外部LLMの回答を、区切り（@@@）の行で下書きに分ける（specs/003-prompt-bulk-register research.md R3）。
// Web（送る前の確認）と API（登録）が同じ判定を使う。

/** 区切りの行の判定に使う形。前後の空白・`*`・`_`・`` ` ``を除くと「@」が3つ以上だけ並ぶ行。 */
const DELIMITER_LINE = /^[\s*_`]*@{3,}[\s*_`]*$/;

/** splitDrafts の結果。 */
export type SplitResult = {
  /** 下書きの本文（貼り付けたテキストの順。前後の空白・改行は除いてある） */
  parts: string[];
  /** 区切りの行が1つでも見つかったか */
  delimiterFound: boolean;
};

/**
 * 貼り付けたテキストを、区切りの行で下書きに分ける。
 * 全角の「＠＠＠」や、太字・コードで装飾された「@@@」の行も区切りとして扱う（NFKC正規化したうえで判定する）。
 * 本文は元の文字のまま使い、行の一部にある「@@@」では分けない。区切りがなければ全体を1件にする。
 * @param text - 貼り付けたテキスト
 * @returns 下書きの本文の一覧と、区切りが見つかったか
 */
export function splitDrafts(text: string): SplitResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const chunks: string[][] = [[]];
  let delimiterFound = false;
  for (const line of lines) {
    if (DELIMITER_LINE.test(line.normalize("NFKC"))) {
      delimiterFound = true;
      chunks.push([]);
    } else {
      chunks[chunks.length - 1]!.push(line);
    }
  }
  const parts = chunks.map((c) => c.join("\n").trim()).filter((p) => p !== "");
  return { parts, delimiterFound };
}

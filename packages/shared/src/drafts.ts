// 外部LLMの回答を、区切り（@@@）の行で下書きに分ける（specs/003-prompt-bulk-register research.md R3）。
// Web（送る前の確認）と API（登録）が同じ判定を使う。
import { DRAFT_BODY_MAX, PASTE_MAX_CHARS, PASTE_MAX_DRAFTS } from "./limits";

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

/**
 * 1回の貼り付けの上限（FR-014）を確かめる。文字数はコードポイントで数える（DB の char_length と同じ）。
 * @param text - 貼り付けたテキスト全体
 * @param parts - splitDrafts で分けた下書き
 * @returns 超えている項目（"text"：全体が50,000文字超、"drafts"：50件超、"draft:N"：N件目（1始まり）が2,000文字超）。超えていなければ null
 */
export function findPasteProblem(text: string, parts: string[]): string | null {
  if ([...text].length > PASTE_MAX_CHARS) return "text";
  if (parts.length > PASTE_MAX_DRAFTS) return "drafts";
  const i = parts.findIndex((p) => [...p].length > DRAFT_BODY_MAX);
  return i >= 0 ? `draft:${i + 1}` : null;
}

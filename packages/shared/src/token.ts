// 貼り付けたトークンの前処理と形の判定（specs/010-token-account-add research.md R1、FR-003）。
// Threads のトークンの形は公開されていないので、先頭の文字列では判定しない。
import { TOKEN_MAX_LENGTH, TOKEN_MIN_LENGTH } from "./limits";

const EDGE = /^[\s"'`　]+|[\s"'`　]+$/g;
const SHAPE = /^[A-Za-z0-9_\-.|]+$/;

/**
 * 貼り付けた文字列の前後の空白・改行・引用符を取り除く。
 * @param raw - 貼り付けた文字列
 * @returns 取り除いた後の文字列
 */
export function cleanToken(raw: string): string {
  return raw.replace(EDGE, "");
}

/**
 * トークンの形か（長さと使える文字）を確かめる。前後は cleanToken で取り除いておく。
 * @param token - 確かめる文字列
 * @returns トークンの形なら true
 */
export function isTokenShaped(token: string): boolean {
  return token.length >= TOKEN_MIN_LENGTH && token.length <= TOKEN_MAX_LENGTH && SHAPE.test(token);
}

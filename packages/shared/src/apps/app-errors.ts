// アプリごとのエラーコードと文言をまとめる（specs/meguru/031-conflict-free-composition）。errors.ts が ERROR_CODES と errorMessage に足す。
// アプリを足すときは、import を1行と、2つの一覧に1行ずつ足すだけにする。
// このファイルは .gitattributes で merge=union にしてある：1行に1つだけ書き、ほかの中身を足さない（docs/parallel-development.md 11）。
import { COLLECT_ERROR_CODES, COLLECT_ERROR_MESSAGES } from "./collect/errors";
import { PEOPLE_ERROR_CODES, PEOPLE_ERROR_MESSAGES } from "./people/errors";

/** アプリのエラーコード。 */
// prettier-ignore
export const APP_ERROR_CODES = [
  ...COLLECT_ERROR_CODES,
  ...PEOPLE_ERROR_CODES,
] as const;

/** アプリのエラーコードの型。 */
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** アプリのエラーの文言。 */
// prettier-ignore
export const APP_ERROR_MESSAGES = {
  ...COLLECT_ERROR_MESSAGES,
  ...PEOPLE_ERROR_MESSAGES,
} satisfies Record<AppErrorCode, unknown>;

// Threadsで許可するときのアカウントの案内（specs/025-threads-account-guide data-model.md 3、research.md R3・R4）。
// 許可の画面は、ブラウザで threads.com にログインしているアカウントを使い、アプリから切り替えられない（research.md R1）。
// 文と手順はここだけに置き、画面（押す前の案内・戻ったときの手順）はこれを出すだけにする。
import type { ErrorCode } from "./errors";

/** threads.com のトップ（新しいタブで開く）。 */
export const THREADS_WEB_URL = "https://www.threads.com/";

/** 違うThreadsアカウントで許可したときに起きる、切り替えの手順を出すエラー（research.md R3）。 */
export const ACCOUNT_SWITCH_ERRORS = ["RECONNECT_ACCOUNT_MISMATCH", "THREADS_ACCOUNT_TAKEN", "ACCOUNT_ALREADY_REGISTERED"] as const;

/**
 * 切り替えの手順を出すエラーか。
 * @param code - エラーコード（なければ null）
 * @returns 出すなら true
 */
export function isAccountSwitchError(code: ErrorCode | null | undefined): boolean {
  return !!code && (ACCOUNT_SWITCH_ERRORS as readonly string[]).includes(code);
}

/**
 * 押す前の案内の文を、画面で@名前を太字にできるように分けて返す（FR-001・FR-002）。
 * @param expected - 使うべきアカウントのユーザー名（@なし。決まっていなければ null）
 * @returns lead：前半の文、check：@名前とそれに続く文（決まっていなければ null）
 */
export function accountGuideParts(expected: string | null): { lead: string; check: { name: string; rest: string } | null } {
  return {
    lead: "threads.comでログインしているアカウントで許可されます。",
    check: expected ? { name: `@${expected}`, rest: " でログインしているか確かめてください。" } : null,
  };
}

/**
 * 「Threadsで許可する」の下に出す、押す前の案内の文（FR-001・FR-002）。
 * @param expected - 使うべきアカウントのユーザー名（@なし。決まっていなければ null）
 * @returns 案内の文
 */
export function accountGuideLead(expected: string | null): string {
  const { lead, check } = accountGuideParts(expected);
  return check ? `${lead}${check.name}${check.rest}` : lead;
}

/**
 * 違うアカウントが出たときの、切り替えの手順の3行（FR-003・FR-005）。
 * @param expected - 使うべきアカウントのユーザー名（@なし。決まっていなければ null）
 * @param again - もう一度押すボタンの名前（「接続し直す」「Threadsで許可する」）
 * @returns 手順の3行
 */
export function accountSwitchSteps(expected: string | null, again: string): [string, string, string] {
  return [
    "threads.com（またはThreadsのアプリ）で、今のアカウントからログアウトする",
    expected ? `@${expected} でログインし直す` : "つなぎたいアカウントでログインし直す",
    `このページに戻って、もう一度「${again}」を押す`,
  ];
}

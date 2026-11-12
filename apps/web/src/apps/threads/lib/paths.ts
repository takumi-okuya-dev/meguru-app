// Threadsの画面のURLを作る（specs/028-meguru-shell tasks.md T033）。URLの頭（/threads）と形はここだけに書く。
/** Threadsの画面のURLの頭。 */
export const THREADS_BASE = "/threads";

/**
 * 頭のあとに、残りのパスをつなぐ。
 * @param head - 頭（例：/threads/accounts/a1）
 * @param sub - 残り（例：settings・stock?tab=approved。空ならつながない）
 * @returns URL
 */
const join = (head: string, sub: string) => (sub ? `${head}/${sub}` : head);

/**
 * Threadsのホーム（最後に使ったアカウントへの振り分け）。
 * @returns URL
 */
export function threadsHomePath(): string {
  return THREADS_BASE;
}

/**
 * アカウントを作る画面。
 * @returns URL
 */
export function newAccountPath(): string {
  return `${THREADS_BASE}/accounts/new`;
}

/**
 * アカウントの画面。
 * @param accountId - アカウントのID
 * @param sub - アカウントの下の画面（例：settings・stock?tab=approved。省略するとホーム）
 * @returns URL
 */
export function accountPath(accountId: string, sub = ""): string {
  return join(`${THREADS_BASE}/accounts/${accountId}`, sub);
}

/**
 * アカウントのホームのURL。
 * @param accountId - アカウントのID
 * @returns URL
 */
export function accountHomePath(accountId: string): string {
  return accountPath(accountId);
}

/**
 * チームの画面。
 * @param teamId - チームのID
 * @param sub - チームの下の画面（例：assign・status。省略するとチームのページ）
 * @returns URL
 */
export function teamPath(teamId: string, sub = ""): string {
  return join(`${THREADS_BASE}/teams/${teamId}`, sub);
}

/**
 * 見せてもらっているアカウントの、読むだけの画面。
 * @param teamId - チームのID
 * @param accountId - アカウントのID
 * @returns URL
 */
export function sharedAccountPath(teamId: string, accountId: string): string {
  return teamPath(teamId, `accounts/${accountId}`);
}

// Threadsの画面のURLを作る（specs/028-meguru-shell tasks.md T033）。URLの形はここだけに書く。
/**
 * アカウントのホームのURL。
 * @param accountId - アカウントのID
 * @returns URL
 */
export function accountHomePath(accountId: string): string {
  return `/threads/accounts/${accountId}`;
}

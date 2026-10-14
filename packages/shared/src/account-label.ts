// アカウントの示し方（specs/012-accounts-before-connect research.md R2、contracts/ui-routes.md「アカウントの示し方」）。
// 主の名前はいつもアカウントの名前。@ユーザー名はつないでいれば添える。画面ごとに displayName ?? username を書かない。

/** 示し方を決めるのに使う、アカウントの値。 */
export type AccountLabelInput = {
  name: string;
  username: string | null;
  /** 省略は接続中として扱う */
  connectionStatus?: "connected" | "needs_reconnect" | "not_connected";
};

/** アカウントの示し方。 */
export type AccountLabel = {
  /** 主に出す名前（アカウントの名前） */
  primary: string;
  /** 添える名前（@ユーザー名）。未接続ならNULL */
  secondary: string | null;
  /** 画像がないときの頭文字 */
  initial: string;
  /** 未接続の印を出すか */
  notConnected: boolean;
};

/**
 * アカウントの示し方を決める。
 * @param account - アカウントの名前・ユーザー名・接続の状態
 * @returns 主の名前・添える名前・頭文字・未接続か
 */
export function accountLabel(account: AccountLabelInput): AccountLabel {
  const first = Array.from(account.name.trim())[0] ?? "?";
  return {
    primary: account.name,
    secondary: account.username ? `@${account.username}` : null,
    initial: first.toUpperCase(),
    notConnected: account.connectionStatus === "not_connected",
  };
}

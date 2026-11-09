// 運営者のアカウント一覧（specs/026-operator-accounts data-model.md 4、research.md R2〜R5）。
// 表示名はここだけに置き、画面はこれを出すだけにする。

/** 接続方法の絞り込み（すべて・Threadsで許可する・トークン・つなぐ前）。 */
export const OPERATOR_ACCOUNT_METHODS = ["all", "app", "token", "none"] as const;
/** 接続方法の絞り込み。 */
export type OperatorAccountMethodFilter = (typeof OPERATOR_ACCOUNT_METHODS)[number];
/** 行の接続方法（つなぐ前は none）。 */
export type OperatorAccountMethod = Exclude<OperatorAccountMethodFilter, "all">;

/** 接続方法の表示名。 */
export const OPERATOR_ACCOUNT_METHOD_LABELS: Record<OperatorAccountMethodFilter, string> = {
  all: "すべて",
  app: "Threadsで許可する",
  token: "トークン",
  none: "つなぐ前",
};

/** 接続の状態の表示名。 */
export const CONNECTION_STATUS_LABELS = {
  connected: "接続中",
  needs_reconnect: "要再接続",
  not_connected: "つなぐ前",
} as const;

/** 一覧に出すテスター招待の状態（生きている申し込み、なければ枠を使ったまま残っている「外してよい」。research.md R4）。 */
export const OPERATOR_ACCOUNT_TESTER_STATES = ["pending", "invited", "connected", "removable"] as const;
/** 一覧に出すテスター招待の状態。 */
export type OperatorAccountTesterState = (typeof OPERATOR_ACCOUNT_TESTER_STATES)[number];

/** テスター招待の状態の表示名（「テスター招待」のタブと同じ言葉）。 */
export const OPERATOR_ACCOUNT_TESTER_LABELS: Record<OperatorAccountTesterState, string> = {
  pending: "申し込み中",
  invited: "招待済み",
  connected: "接続済み",
  removable: "外してよい",
};

/** 1回に返す行の数（research.md R2）。 */
export const OPERATOR_ACCOUNTS_PAGE_SIZE = 50;
/** 検索語の文字数の上限（research.md R3）。 */
export const OPERATOR_ACCOUNTS_QUERY_MAX = 100;

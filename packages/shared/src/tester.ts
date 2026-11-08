// テスター招待の申し込み（specs/024-tester-invite-connect research.md R1〜R3・R14、data-model.md 1-1・3）

/** 申し込みの状態（申し込み中・招待済み・接続済み・見送り・取り下げ）。 */
export const TESTER_APPLICATION_STATUSES = ["pending", "invited", "connected", "declined", "withdrawn"] as const;
/** 申し込みの状態。 */
export type TesterApplicationStatus = (typeof TESTER_APPLICATION_STATUSES)[number];

/** 「生きている」申し込みの状態（アカウント1件に1つまで。FR-005）。 */
export const LIVE_TESTER_APPLICATION_STATUSES = ["pending", "invited", "connected"] as const;

/**
 * Metaのテスターから外してよい理由（research.md R2）。
 * アカウントを消した・退会した・招待済みを取り下げた・トークンでつながった・違うユーザー名でつながった。
 */
export const TESTER_REMOVAL_REASONS = [
  "account_deleted",
  "user_withdrawn",
  "withdrawn",
  "token_connected",
  "username_mismatch",
] as const;
/** 外してよい理由。 */
export type TesterRemovalReason = (typeof TESTER_REMOVAL_REASONS)[number];

/** 外してよい理由の、運営者の画面の文（contracts/ui-routes.md 5）。 */
export const TESTER_REMOVAL_REASON_LABELS: Record<TesterRemovalReason, string> = {
  account_deleted: "アカウントが消されました",
  user_withdrawn: "利用者が退会しました",
  withdrawn: "申し込みが取り下げられました",
  token_connected: "トークンでつながりました",
  username_mismatch: "別のアカウントでつながりました",
};

/** 運営者の一覧の見え方（contracts/api.md「運営者の招待の管理」）。 */
export const TESTER_APPLICATION_VIEWS = ["pending", "invited", "connected", "removable", "closed"] as const;
/** 運営者の一覧の見え方。 */
export type TesterApplicationView = (typeof TESTER_APPLICATION_VIEWS)[number];

/** 申し込みと取り消しの回数の制限（10分に5回まで。FR-006）。 */
export const TESTER_APPLY_RATE = { count: 5, windowMinutes: 10 } as const;
/** 見送りの理由の長さの上限。 */
export const DECLINE_REASON_MAX = 200;
/** テスター枠の数の初めの値（運営者が変える目安。research.md R2）。 */
export const TESTER_SLOT_CAPACITY_DEFAULT = 25;
/** テスター枠の数の範囲。 */
export const TESTER_SLOT_CAPACITY_MIN = 1;
/** テスター枠の数の範囲。 */
export const TESTER_SLOT_CAPACITY_MAX = 10000;
/** 運営者の一覧に出す件数の上限。 */
export const TESTER_APPLICATIONS_LIST_LIMIT = 200;

/** Threadsのユーザー名の形（Instagramと同じ規則。小文字にそろえたあと）。 */
const THREADS_USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

/**
 * 入力されたThreadsのユーザー名を、保存・照合する形にそろえる（research.md R3）。
 * 前後の空白と先頭の`@`を1つ取り、小文字にする。形が違えば null。
 * @param raw - 入力
 * @returns そろえたユーザー名。使えない形なら null
 */
export function normalizeThreadsUsername(raw: string): string | null {
  const trimmed = raw.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const lower = withoutAt.toLowerCase();
  return THREADS_USERNAME_PATTERN.test(lower) ? lower : null;
}

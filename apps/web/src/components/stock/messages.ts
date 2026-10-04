// 投稿ストックの画面の文言（specs/003・004 contracts/ui-routes.md）。
import { APPROVED_LIMIT, NEEDS_REVIEW_LIMIT, type SkipReason } from "@threads-grower/shared";

/** 要確認の下書きが上限に達したときの文言（一覧の上の案内と、登録の 409 ITEM_LIMIT_REACHED）。 */
export const STOCK_LIMIT_MESSAGE = `要確認の下書きが上限（${NEEDS_REVIEW_LIMIT}件）に達しています。不要な下書きを削除してから登録してください。`;

// ---- 承認・却下（specs/004-review-approval contracts/ui-routes.md「承認」）----

/**
 * 1件の操作で状態を変えられなかったときの文言（skipped の理由ごと）。
 * @param reason - 変えなかった理由
 * @param action - 操作
 * @returns 文言
 */
export function skipMessage(reason: SkipReason, action: "approve" | "reject" | "reopen"): string {
  switch (reason) {
    case "NG_WORD":
      return "NGワードを含むため承認できませんでした。";
    case "OVER_THREADS_LIMIT":
      return "Threadsの上限を超えるため承認できませんでした。";
    case "POLICY_CONFIRM_REQUIRED":
      return "規約に注意の表現があるため、確認してから承認してください。";
    case "STALE":
      return "他の場所で更新されています。最新の内容を表示しました。";
    case "NOT_FOUND":
      return "この下書きは削除されています。";
    case "LIMIT":
      return action === "reopen" ? STOCK_LIMIT_MESSAGE : `承認済みの下書きが上限（${APPROVED_LIMIT}件）に達しています。`;
  }
}

/** まとめての操作で飛ばした理由の短い名前（「NGワード 1件・Threadsの上限 2件」）。 */
export const SKIP_REASON_SHORT: Record<SkipReason, string> = {
  NG_WORD: "NGワード",
  OVER_THREADS_LIMIT: "Threadsの上限",
  POLICY_CONFIRM_REQUIRED: "規約の確認なし",
  STALE: "他の場所で更新",
  NOT_FOUND: "削除済み",
  LIMIT: "上限",
};

/** 承認ボタンを押せないときの、ボタンの下に出す理由。 */
export const NOT_APPROVABLE_NG = "NGワードを含むため承認できません。本文を直すか却下してください";
/** 承認ボタンを押せないときの、ボタンの下に出す理由（Threadsの上限）。 */
export const NOT_APPROVABLE_LIMIT = "Threadsの上限を超えるため承認できません";
/** 承認済みのタブの上の案内（FR-011）。 */
export const APPROVED_TAB_NOTICE = "承認した投稿は、自動投稿の設定ができると順に投稿されます";
/** 承認済みの下書きを直したときの案内（FR-007）。 */
export const REOPENED_BY_EDIT = "直したので、要確認に戻しました。もう一度承認してください";

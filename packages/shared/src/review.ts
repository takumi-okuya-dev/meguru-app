// 承認・却下の判定と却下理由（specs/004-review-approval research.md R10・R14）。
// checkPublishable は承認のチェック（API）・ラベル（Web）・配信の直前のチェック（005）で同じものを使う。
import { findNgWords, type NgWordForMatch, type NgWordHit } from "./ng-words";
import { isOverThreadsLimit } from "./threads-text";

/** 却下理由の候補（コードと表示名）。コードをDBに保存し、表示とプロンプトでは表示名にする。 */
export const REJECT_REASONS = [
  { code: "similar", label: "似た投稿がある" },
  { code: "tone", label: "トーンが違う" },
  { code: "thin", label: "内容が薄い" },
  { code: "inaccurate", label: "事実と違う" },
  { code: "too_promotional", label: "宣伝っぽすぎる" },
  { code: "policy", label: "規約に触れそう" },
] as const;

/** 却下理由の候補のコード。 */
export type RejectReasonCode = (typeof REJECT_REASONS)[number]["code"];

/** 却下理由の候補のコードの一覧。 */
export const REJECT_REASON_CODES = REJECT_REASONS.map((r) => r.code) as [
  RejectReasonCode,
  ...RejectReasonCode[],
];

/**
 * 却下理由の候補のコードを表示名にする。
 * @param code - 候補のコード
 * @returns 表示名
 */
export function rejectReasonLabel(code: RejectReasonCode): string {
  return REJECT_REASONS.find((r) => r.code === code)!.label;
}

/** 「規約に注意」の照合の結果（US5で中身を入れる）。 */
export type PolicyCautionHit = {
  id: string;
  label: string;
  policyName: string;
  policyUrl: string;
  suggestion: string;
  ranges: [number, number][];
};

/** 配信できるかの判定の結果。 */
export type PublishCheck = {
  ngWords: NgWordHit[];
  overThreadsLimit: boolean;
  policyCautions: PolicyCautionHit[];
  /** 承認できるか（NGワードなし、かつThreadsの上限内）。規約に注意は確認が要るだけで、承認は止めない */
  approvable: boolean;
};

/**
 * 下書きを承認・配信できるかを判定する（FR-005・FR-018）。
 * @param body - 下書きの本文
 * @param ngWords - そのAccountのNGワード
 * @returns 判定の結果
 */
export function checkPublishable(body: string, ngWords: NgWordForMatch[]): PublishCheck {
  const ng = findNgWords(body, ngWords);
  const overThreadsLimit = isOverThreadsLimit(body);
  return {
    ngWords: ng,
    overThreadsLimit,
    policyCautions: [],
    approvable: ng.length === 0 && !overThreadsLimit,
  };
}

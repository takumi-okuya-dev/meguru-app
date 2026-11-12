// Threadsの機能のまとまり（specs/019-feature-switches data-model.md「まとまり」）。運営者が人ごと・グループごとにON/OFFする単位。
// 029 で共通の features.ts から移した（specs/meguru/029-threads-pattern1 tasks.md T021）。共通の運営の画面は、この名前を直接書かず、
// 登録の一覧（GET /api/operator/app-registry）で出す。DBの CHECK もこの3つ。

/**
 * 機能のまとまり（FR-001）。自動投稿＝投稿をつくる・投稿ストック・パフォーマンス・自動投稿の設定、戦略＝課題・宣伝内容・リサーチ、
 * チーム＝チームを作る・入る・手伝う・見せてもらう。ホームと設定は、まとまりに含めず、いつも使える。
 */
export const FEATURES = ["autopost", "strategy", "team"] as const;

/** 機能のまとまりの値。 */
export type Feature = (typeof FEATURES)[number];

/** 画面に出す、まとまりの名前。 */
export const FEATURE_LABELS: Record<Feature, string> = {
  autopost: "自動投稿",
  strategy: "戦略",
  team: "チーム",
};

/**
 * 文字列が機能のまとまりかを確かめる。
 * @param value - 確かめる値
 * @returns まとまりなら true
 */
export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (FEATURES as readonly string[]).includes(value);
}


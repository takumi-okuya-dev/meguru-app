// 機能のまとまり（specs/019-feature-switches data-model.md「まとまり」）。運営者が人ごと・グループごとにON/OFFする単位。
// プランはまだ決めず、あとで「ONにするまとまりの組み合わせ」として決める。DBの CHECK もこの3つ。

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

/** 機能の設定の記録の種類（data-model.md「feature_setting_events」）。 */
export const FEATURE_EVENT_ACTIONS = ["disabled", "enabled"] as const;

/** 機能の設定の記録の種類の値。 */
export type FeatureEventAction = (typeof FEATURE_EVENT_ACTIONS)[number];

/** 運営者の画面に出す、最近の変更の件数（research.md R7）。 */
export const FEATURE_EVENTS_LIMIT = 50;

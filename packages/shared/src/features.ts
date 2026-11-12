// 機能のまとまりのON/OFFの、共通の部分（specs/019-feature-switches data-model.md「feature_setting_events」）。
// まとまりの名前（Threadsなら autopost・strategy・team）はアプリが決めて登録する（apps/threads/features.ts。specs/meguru/029 tasks.md T021）。

/** 機能の設定の記録の種類（data-model.md「feature_setting_events」）。 */
export const FEATURE_EVENT_ACTIONS = ["disabled", "enabled"] as const;

/** 機能の設定の記録の種類の値。 */
export type FeatureEventAction = (typeof FEATURE_EVENT_ACTIONS)[number];

/** 運営者の画面に出す、最近の変更の件数（research.md R7）。 */
export const FEATURE_EVENTS_LIMIT = 50;

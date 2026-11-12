// Threadsが共通に登録する、機能のまとまりと上限の名前（specs/meguru/029-threads-pattern1 research.md R7）。
// 名前・表示名・範囲はThreadsが決める。共通のコードにはこの名前を書かない。
import { ACCOUNT_LIMIT_MAX, DAILY_POST_LIMIT_MAX, FEATURE_LABELS } from "@meguru/shared";
import type { AppFeatureDef, AppLimitDef } from "../../platform";

/** Threadsのアプリの番号（@meguru/shared の APP_CATALOG の id と同じ）。 */
export const THREADS_APP = "threads";

/** Threadsの機能のまとまり（並びは運営の画面の順）。 */
export const THREADS_FEATURES: readonly AppFeatureDef[] = [
  { key: "autopost", label: FEATURE_LABELS.autopost, description: "自動投稿は、投稿をつくる・投稿ストック・パフォーマンスのまとまりです" },
  { key: "strategy", label: FEATURE_LABELS.strategy },
  { key: "team", label: FEATURE_LABELS.team },
];

/** Threadsの上限（運営者は、アカウントの数は上限なし・1日の投稿数は最大。specs/024 data-model.md 4）。 */
export const THREADS_LIMITS: Readonly<Record<string, AppLimitDef>> = {
  accounts: { label: "アカウントの数", min: 1, max: ACCOUNT_LIMIT_MAX, operatorValue: null },
  daily_posts: { label: "1日の投稿数", min: 1, max: DAILY_POST_LIMIT_MAX, operatorValue: DAILY_POST_LIMIT_MAX },
};

// 運営の画面のテストで使う、登録の一覧（GET /api/operator/app-registry）。今のThreadsの登録と同じ中身（specs/meguru/029 T070）。
import { ACCOUNT_LIMIT_MAX, DAILY_POST_LIMIT_MAX, FEATURE_LABELS, type OperatorAppRegistry } from "@meguru/shared";

export const THREADS_REGISTRY: OperatorAppRegistry = {
  apps: [
    {
      app: "threads",
      featureSwitches: true,
      features: [
        { key: "autopost", label: FEATURE_LABELS.autopost, description: "自動投稿は、投稿をつくる・投稿ストック・パフォーマンスのまとまりです" },
        { key: "strategy", label: FEATURE_LABELS.strategy },
        { key: "team", label: FEATURE_LABELS.team },
      ],
      limits: [
        { key: "accounts", label: "アカウントの数", min: 1, max: ACCOUNT_LIMIT_MAX, operatorValue: null },
        { key: "daily_posts", label: "1日の投稿数", min: 1, max: DAILY_POST_LIMIT_MAX, operatorValue: DAILY_POST_LIMIT_MAX },
      ],
    },
  ],
};

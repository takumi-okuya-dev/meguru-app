import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

/** TanStack Query のクライアント。認証・権限・存在しない・設定の誤りは再試行しない。 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 認証・権限・存在しないエラーは再試行しない
      // 認証・権限・存在しない・設定の誤りは、再試行しても直らないので再試行しない
      retry: (failureCount, error) =>
        !(
          error instanceof ApiError &&
          ([401, 403, 404, 409, 422].includes(error.status) || error.code === "CONFIG_ERROR")
        ) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** TanStack Query のキー。 */
export const queryKeys = {
  me: ["me"] as const,
  account: (id: string) => ["account", id] as const,
  // 戦略プロファイル（specs/002-strategy-profile）。Account 単位で持ち、Account の削除で一緒に消す
  profileStatus: (id: string) => ["account", id, "profile-status"] as const,
  strategy: (id: string) => ["account", id, "strategy"] as const,
  promotions: (id: string) => ["account", id, "promotions"] as const,
  promotionSettings: (id: string) => ["account", id, "promotion-settings"] as const,
  referencePosts: (id: string) => ["account", id, "reference-posts"] as const,
  researchKeywords: (id: string) => ["account", id, "research-keywords"] as const,
  // 投稿ストック（specs/003-prompt-bulk-register）。プロンプトは件数ごとのキーで、取り直しは ["account", id, "prompt"] の範囲で行う
  prompt: (id: string, count: number) => ["account", id, "prompt", count] as const,
  promptAll: (id: string) => ["account", id, "prompt"] as const,
  postDrafts: (id: string) => ["account", id, "post-drafts"] as const,
  // 承認・却下（specs/004-review-approval）。件数は post-drafts の下に置き、下書きの取り直しで一緒に取り直す
  draftCounts: (id: string) => ["account", id, "post-drafts", "counts"] as const,
  postingRules: (id: string) => ["account", id, "posting-rules"] as const,
  // 自動投稿（specs/005-auto-post）。投稿済みの一覧は post-drafts の下に置かない（状態の変更の後に読み直さない。research.md R14）
  postingSchedule: (id: string) => ["account", id, "posting-schedule"] as const,
  autoPost: (id: string) => ["account", id, "auto-post"] as const,
  published: (id: string) => ["account", id, "published"] as const,
  // パフォーマンス（specs/006-performance-feedback）。タブごとのキーで、取り直しは ["account", id, "performance"] の範囲で行う
  performance: (id: string, tab: string) => ["account", id, "performance", tab] as const,
  performanceAll: (id: string) => ["account", id, "performance"] as const,
};

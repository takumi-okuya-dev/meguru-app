import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

/** TanStack Query のクライアント。認証・権限・存在しない・設定の誤りは再試行しない。 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 認証・権限・存在しないエラーは再試行しない
      // 認証・権限・存在しない・設定の誤りは、再試行しても直らないので再試行しない
      retry: (failureCount, error) =>
        !(error instanceof ApiError && ([401, 403, 404, 409, 422].includes(error.status) || error.code === "CONFIG_ERROR")) &&
        failureCount < 2,
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
};

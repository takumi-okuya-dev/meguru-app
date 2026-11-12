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

/** TanStack Query のキー（共通の分。Threadsの分は apps/threads/lib/query-keys.ts。specs/meguru/029 contracts/api-routes.md 4）。 */
export const queryKeys = {
  me: ["me"] as const,
  // 契約と支払い（specs/013）
  billing: ["billing"] as const,
  withdrawalPreview: ["me", "withdrawal-preview"] as const,
  // テスト用のグループ（specs/016）
  testInvite: (token: string) => ["test-invite", token] as const,
  testGroups: ["test-groups"] as const,
  referral: ["referral"] as const,
  referralPage: ["referral-page"] as const,
  testGroup: (id: string) => ["test-groups", id] as const,
  // 機能のまとまりごとのON/OFF（specs/019）
  featureSettings: ["feature-settings"] as const,
  operatorLimits: ["operator-limits"] as const,
};

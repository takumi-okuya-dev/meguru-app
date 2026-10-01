import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 認証・権限・存在しないエラーは再試行しない
      retry: (failureCount, error) =>
        !(error instanceof ApiError && [401, 404, 422].includes(error.status)) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  me: ["me"] as const,
  account: (id: string) => ["account", id] as const,
};

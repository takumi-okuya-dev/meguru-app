// Threadsの「自分」を読む（GET /api/threads/me。specs/meguru/029-threads-pattern1 tasks.md T051）。
// アカウント・チーム・使える機能・上限など、Threadsの中身はここから読む。共通の中身（契約・アプリの一覧など）は今どおり GET /api/me。
import { useQuery } from "@tanstack/react-query";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";

/**
 * Threadsの「自分」を読むフック。
 * @param opts - 開くたびに読み直すか（refetchOnMount）
 * @returns TanStack Query の結果
 */
export function useThreadsMe(opts: { refetchOnMount?: boolean | "always" } = {}) {
  return useQuery({ queryKey: threadsQueryKeys.me, queryFn: threadsApi.me, ...opts });
}

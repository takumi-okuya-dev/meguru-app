import { useInfiniteQuery } from "@tanstack/react-query";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";

/**
 * 投稿済みを50件ずつ読む。投稿済みのタブ内でのみ使い、開き直したときに更新する。
 * @param accountId - AccountのID
 * @returns 投稿済みのページと追加の読み込み操作
 */
export function usePublished(accountId: string) {
  return useInfiniteQuery({
    queryKey: threadsQueryKeys.published(accountId),
    queryFn: ({ pageParam }) => threadsApi.listPublished(accountId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
}

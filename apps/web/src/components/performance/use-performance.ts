// パフォーマンスの一覧の読み込み（specs/006-performance-feedback contracts/api.md、ui-routes.md）。タブごとに50件ずつ読む。
import { useInfiniteQuery } from "@tanstack/react-query";
import type { PerformanceTab } from "@threads-grower/shared";
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

const TABS: PerformanceTab[] = ["all", "good", "normal", "poor", "pending"];

/**
 * URL のクエリの tab を読み書きする。値が正しくなければ「すべて」にする。
 * @returns tab：表示するタブ、setTab：タブを変える
 */
export function usePerformanceTab(): { tab: PerformanceTab; setTab: (tab: PerformanceTab) => void } {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = TABS.includes(raw as PerformanceTab) ? (raw as PerformanceTab) : "all";
  const setTab = useCallback(
    (next: PerformanceTab) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "all") p.delete("tab");
          else p.set("tab", next);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { tab, setTab };
}

/**
 * 選んだタブの一覧を50件ずつ読む。集計（summary）は最後に読んだページのものを使う。
 * @param accountId - AccountのID
 * @param tab - タブ
 * @returns 一覧のページと追加の読み込み操作
 */
export function usePerformance(accountId: string, tab: PerformanceTab) {
  return useInfiniteQuery({
    queryKey: queryKeys.performance(accountId, tab),
    queryFn: ({ pageParam }) => api.getPerformance(accountId, tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
}

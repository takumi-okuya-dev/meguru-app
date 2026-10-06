// 投稿ストックの状態のタブ（specs/004-review-approval FR-001、contracts/ui-routes.md「状態のタブ」）。
// 選んだタブは URL のクエリ（?tab=approved など）に持ち、再読み込みしても保つ。
import type { DraftCounts } from "@threads-grower/shared";
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

/** 投稿ストックのタブ（下書きの状態とは別。承認済みのタブには、投稿の処理中も入る。005） */
export type StockTab = "needs_review" | "approved" | "rejected" | "published";

const TABS: { value: StockTab; label: string; count: keyof DraftCounts }[] = [
  { value: "needs_review", label: "要確認", count: "needsReview" },
  { value: "approved", label: "承認済み", count: "approved" },
  { value: "rejected", label: "却下", count: "rejected" },
  { value: "published", label: "投稿済み", count: "published" },
];

/**
 * URL のクエリの tab を読み書きする。値が正しくなければ要確認にする。
 * @returns tab：表示するタブ、setTab：タブを変える
 */
export function useStatusTab(): { tab: StockTab; setTab: (tab: StockTab) => void } {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = TABS.some((t) => t.value === raw) ? (raw as StockTab) : "needs_review";
  const setTab = useCallback(
    (next: StockTab) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "needs_review") p.delete("tab");
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
 * 4つの状態のタブ（件数つき）。Tabs（Radix）の中に置く。
 * @param props - counts：状態ごとの件数（読み込み前は undefined）
 * @returns タブの一覧
 */
export function StatusTabs({ counts }: { counts?: DraftCounts }) {
  return (
    <TabsList className="min-w-0 max-w-full justify-start overflow-x-auto">
      {TABS.map((t) => (
        <TabsTrigger className="flex-none whitespace-nowrap" key={t.value} value={t.value}>
          {t.label} {counts ? counts[t.count] : ""}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

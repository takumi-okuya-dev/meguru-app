// 判定で絞り込むタブ（specs/006-performance-feedback FR-015）。好調〜確定待ちはアイコンと件数で出す。
import type { PerformanceSummary, PerformanceTab } from "@meguru/shared";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JudgmentDot } from "./JudgmentBadge";

const TABS: { value: PerformanceTab; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "good", label: "伸びた" },
  { value: "normal", label: "いつも通り" },
  { value: "poor", label: "伸びなかった" },
  { value: "pending", label: "確定待ち" },
];

/**
 * タブの一覧。Tabs（Radix）の中に置く。
 * @param props - counts：タブごとの件数（読み込み前は undefined）
 * @returns タブ
 */
export function PerformanceTabs({ counts }: { counts?: PerformanceSummary["counts"] }) {
  return (
    <TabsList className="min-w-0 max-w-full justify-start overflow-x-auto">
      {TABS.map((t) => (
        <TabsTrigger
          key={t.value}
          value={t.value}
          className="flex-none gap-1.5 whitespace-nowrap"
          aria-label={`${t.label} ${counts ? counts[t.value] : 0}件`}
        >
          {t.value === "all" ? <span>すべて</span> : <JudgmentDot kind={t.value} />}
          <span>{counts ? counts[t.value] : ""}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

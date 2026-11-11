// 自動投稿の時刻の見直しの参考（specs/022 FR-040b）。時刻は自動では変えない。
import type { AnalysisResponse } from "@meguru/shared";
import { Link } from "react-router";
import { formatSlotTime } from "@/lib/format";

/**
 * 時刻の参考。
 * @param props - accountId：Account、slotTimes：今の投稿の時刻、trends：傾向
 * @returns 参考の枠
 */
export function ScheduleHint({
  accountId,
  slotTimes,
  trends,
}: {
  accountId: string;
  slotTimes: readonly string[];
  trends: AnalysisResponse["trends"];
}) {
  const timing = trends.filter((t) => t.dimension === "time" || t.dimension === "day");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-dashed px-3.5 py-3 text-[13px]">
      <span className="font-medium">自動投稿の時刻の見直しの参考に</span>
      <span className="text-muted-foreground">
        今の時刻：{slotTimes.length > 0 ? slotTimes.map(formatSlotTime).join("・") : "まだ決めていません"}
      </span>
      <span className="text-muted-foreground">
        伸びやすい：{timing.length > 0 ? timing.map((t) => t.text.replace(/に出した投稿が伸びやすい$/, "")).join("・") : "まだ分かりません"}
      </span>
      <Link to={`/accounts/${accountId}/settings`} className="inline-flex min-h-8 items-center underline-offset-4 hover:underline md:ml-auto">
        投稿の時刻を開く
      </Link>
    </div>
  );
}

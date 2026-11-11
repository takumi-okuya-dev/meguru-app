// 本文の特徴の表（あり・なしの件数と閲覧、差。specs/022 contracts/ui-routes.md 8）。
import type { AnalysisResponse } from "@meguru/shared";
import { MarkChip } from "./MarkChip";
import { num, times } from "./format";

const COLS = "md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_4rem] md:items-center md:gap-3";

/**
 * 本文の特徴の表。
 * @param props - rows：行
 * @returns 表
 */
export function FeatureTable({ rows }: { rows: AnalysisResponse["features"] }) {
  return (
    <div className="overflow-hidden rounded-2xl border">
      <div aria-hidden="true" className={`hidden border-b bg-muted/60 px-4 py-2.5 text-xs text-muted-foreground ${COLS}`}>
        <span>特徴</span>
        <span>あり（件数・閲覧）</span>
        <span>なし（件数・閲覧）</span>
        <span className="text-right">差</span>
      </div>
      <ul aria-label="本文の特徴" className="divide-y">
        {rows.map((r) => (
          <li key={r.key} className={`flex flex-col gap-1 px-4 py-3 text-sm ${COLS}`}>
            <span className="font-medium">
              {r.label}
              <MarkChip mark={r.mark} />
            </span>
            <span className="text-[13px] text-muted-foreground md:text-sm md:text-foreground">
              <span className="md:hidden">あり </span>
              {r.with.count}件・{num(r.with.views)}
            </span>
            <span className="text-[13px] text-muted-foreground md:text-sm md:text-foreground">
              <span className="md:hidden">なし </span>
              {r.without.count}件・{num(r.without.views)}
            </span>
            <span className="text-[13px] md:text-right md:text-sm">
              <span className="text-muted-foreground md:hidden">差 </span>
              {times(r.ratio)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 区切りの表（時間帯・曜日・文字数・書き出しの型・テーマ。specs/022 contracts/ui-routes.md 6〜9）。
// パソコンは列にそろえ、スマートフォンは1行を縦に積む（横にスクロールさせない。FR-063）。
import { ANALYSIS_MIN_BUCKET, type BucketRow } from "@threads-grower/shared";
import type { ReactNode } from "react";
import { MarkChip } from "./MarkChip";
import { num, pct } from "./format";
import { cn } from "@/lib/utils";

const COLS = "md:grid md:grid-cols-[minmax(0,1.6fr)_4rem_minmax(0,2.4fr)_5rem_5rem] md:items-center md:gap-3";

/**
 * 区切りの表。
 * @param props - label：区切りの名前の見出し、rows：行、bars：閲覧の棒を出すか、footer：表の下に置くもの
 * @returns 表
 */
export function BucketTable({
  label,
  rows,
  bars = false,
  footer,
}: {
  label: string;
  rows: readonly BucketRow[];
  bars?: boolean;
  footer?: ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.views ?? 0));
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border">
        <div aria-hidden="true" className={`hidden border-b bg-muted/60 px-4 py-2.5 text-xs text-muted-foreground ${COLS}`}>
          <span>{label}</span>
          <span className="text-right">件数</span>
          <span>閲覧（中央値）</span>
          <span className="text-right">反応率</span>
          <span className="text-right">返信率</span>
        </div>
        <ul aria-label={label} className="divide-y">
          {rows.map((r) => (
            <li key={r.key} className={`flex flex-col gap-1 px-4 py-3 text-sm ${COLS}`}>
              <span className="font-medium">
                {r.label}
                <MarkChip mark={r.mark} />
              </span>
              <span className="hidden text-right md:inline">{r.count}</span>
              <span className="flex items-center gap-2">
                {bars && (
                  <span className="h-2 flex-1 rounded-full bg-muted" aria-hidden="true">
                    <span
                      className={cn("block h-2 rounded-full", r.count >= ANALYSIS_MIN_BUCKET ? "bg-foreground" : "bg-muted-foreground/40")}
                      style={{ width: `${Math.round(((r.views ?? 0) / max) * 100)}%` }}
                    />
                  </span>
                )}
                <span className={cn("text-[13px] md:text-sm", bars && "min-w-12 text-right")}>
                  <span className="text-muted-foreground md:hidden">閲覧 </span>
                  {num(r.views)}
                  <span className="text-muted-foreground md:hidden">（{r.count}件）</span>
                </span>
              </span>
              <span className="text-[13px] text-muted-foreground md:text-right md:text-sm md:text-foreground">
                <span className="md:hidden">反応率 </span>
                {pct(r.engagementRate)}
                <span className="md:hidden">・返信率 {pct(r.replyRate)}</span>
              </span>
              <span className="hidden text-right md:inline">{pct(r.replyRate)}</span>
            </li>
          ))}
        </ul>
      </div>
      {footer}
    </div>
  );
}

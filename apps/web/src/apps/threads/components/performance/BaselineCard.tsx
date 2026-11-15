// 基準値の欄（specs/006-performance-feedback contracts/ui-routes.md、FR-009・FR-012）。
import type { PerformanceSummary } from "@meguru/shared";
import { JudgmentDot } from "./JudgmentBadge";

/**
 * 基準値・説明・アイコンの意味。
 * @param props - summary：集計
 * @returns 基準値の欄
 */
export function BaselineCard({ summary }: { summary: PerformanceSummary }) {
  const value = summary.baseline === null ? "—" : String(Math.round(summary.baseline * 10) / 10);
  return (
    <section aria-label="基準値" className="flex flex-col gap-4 rounded-2xl border bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex shrink-0 flex-col">
        <span className="text-xs text-muted-foreground">基準値（閲覧数）</span>
        <span className="text-3xl leading-tight font-semibold">{value}</span>
      </div>
      <div className="hidden w-px self-stretch bg-border sm:block" />
      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {summary.baseline === null && (
          <span className="font-semibold text-foreground">
            確定した投稿が5件たまると判定を始めます（いま{summary.judgeableCount}件）
          </span>
        )}
        {summary.baselineIsZero && <span className="font-semibold text-foreground">基準値が0のため判定できません</span>}
        <span>確定した直近30件の閲覧数の中央値です。判定は、投稿から約7日後に値が確定してから行います。</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <JudgmentDot kind="good" />
            基準値の2倍以上
          </span>
          <span className="inline-flex items-center gap-1.5">
            <JudgmentDot kind="normal" />
            その間
          </span>
          <span className="inline-flex items-center gap-1.5">
            <JudgmentDot kind="poor" />
            基準値の半分以下
          </span>
        </span>
      </div>
    </section>
  );
}

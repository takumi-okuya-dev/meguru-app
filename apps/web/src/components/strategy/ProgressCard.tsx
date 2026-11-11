// 課題の進み具合のカード（specs/014-strategy-guidance FR-014・FR-015、contracts/ui-routes.md「課題」）。
// 完了n/16項目・要確認n件・活動の目的n/5問・バー・次におすすめ。「全体をAIと整理する」は actions に、その結果の文は below に入れる（行の下に全幅で出し、ボタンを動かさない）。
// actions には「AIと壁打ちして埋める」も並び、狭い幅では折り返す。壁打ちの欄も below に開く（specs/018 contracts/ui-routes.md）。
import { STRATEGY_TOTAL, type StrategyCheck } from "@meguru/shared";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * 進み具合のカード。
 * @param props - check：自動チェックの結果、nextLabel：次におすすめの項目名、onNext：次におすすめを押したとき、actions：右の操作、below：カードの下に出す中身
 * @returns カード
 */
export function ProgressCard({
  check,
  nextLabel,
  onNext,
  actions,
  below,
}: {
  check: StrategyCheck;
  nextLabel: string | null;
  onNext: () => void;
  actions?: ReactNode;
  below?: ReactNode;
}) {
  const percent = Math.round((check.done / STRATEGY_TOTAL) * 100);
  return (
    <section aria-label="進み具合" className="space-y-4 rounded-2xl border px-5 py-4">
      <div className="flex flex-wrap items-end gap-6">
        <Stat label="完了" testId="progress-done" value={check.done} unit={`/ ${STRATEGY_TOTAL}項目`} />
        <Stat label="要確認（短め）" testId="progress-review" value={check.review} unit="件" warn={check.review > 0} />
        <Stat label="活動の目的" testId="progress-purpose" value={check.purposeDone} unit="/ 5問" />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-2 rounded-full bg-foreground transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {nextLabel ? (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-muted px-4 text-left text-sm hover:bg-accent"
          >
            <span className="text-muted-foreground">次におすすめ</span>
            <span className="font-medium">{nextLabel}</span>
            <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
          </button>
        ) : (
          <p className="text-sm font-medium">すべての項目が十分に書けています</p>
        )}
        {actions && <div className="ml-auto flex flex-wrap justify-end gap-2">{actions}</div>}
      </div>
      {below}
    </section>
  );
}

function Stat({ label, value, unit, testId, warn }: { label: string; value: number; unit: string; testId: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-2xl leading-tight font-bold">
        <span data-testid={testId} className={warn ? "text-warning" : undefined}>
          {value}
        </span>
        <span className="text-base font-medium text-muted-foreground"> {unit}</span>
      </span>
    </div>
  );
}

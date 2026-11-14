// 項目の自動チェックの印（specs/014-strategy-guidance FR-010〜FR-012）。十分・短め・未入力。
import type { CheckStatus } from "@meguru/shared";
import { cn } from "@/lib/utils";

const LABELS: Record<CheckStatus, string> = { ok: "十分", short: "短め", empty: "未入力" };

/**
 * 自動チェックの印。
 * @param props - status：判定
 * @returns 印
 */
export function FieldCheckBadge({ status }: { status: CheckStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-medium",
        status === "ok" && "bg-success-bg text-success",
        status === "short" && "bg-warning-bg text-warning",
        status === "empty" && "bg-muted text-muted-foreground",
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}

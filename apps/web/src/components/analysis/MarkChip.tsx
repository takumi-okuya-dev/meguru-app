// 区切りの印（「件数が少ない」「試していない」）。今の灰色の小さい印と同じ見た目（docs/ui-design.md）。
import type { BucketMark } from "@threads-grower/shared";

const LABELS = { few: "件数が少ない", untried: "試していない" } as const;

/**
 * 区切りの印。
 * @param props - mark：印（null なら出さない）
 * @returns 印
 */
export function MarkChip({ mark }: { mark: BucketMark }) {
  if (!mark) return null;
  return (
    <span className="ml-1.5 inline-block rounded-full border px-2 text-[11px] font-normal text-muted-foreground">
      {LABELS[mark]}
    </span>
  );
}

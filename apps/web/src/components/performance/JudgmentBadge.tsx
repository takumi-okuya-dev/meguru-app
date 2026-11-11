// 判定のバッジ（specs/006-performance-feedback contracts/ui-routes.md「判定のアイコン」、FR-013・FR-014）。
// 文字のラベルは出さず、アイコンと倍率で見せる。意味は title と読み上げ用の文字で伝える。
import { formatRatio, type PerformanceItem } from "@meguru/shared";
import { ArrowRightIcon, BanIcon, ClockIcon, TrendingDownIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Look = { Icon: LucideIcon; label: string; text: string; className: string };

const JUDGMENT_LABEL = { good: "伸びた", normal: "いつも通り", poor: "伸びなかった" } as const;

/**
 * 判定（または確定待ち・計測できません）の見た目を決める。
 * @param item - 一覧の項目
 * @returns 見た目。確定したが判定がないときは null
 */
export function judgmentLook(item: Pick<PerformanceItem, "state" | "judgment" | "ratio">): Look | null {
  if (item.state === "pending" || item.state === "updating") {
    return {
      Icon: ClockIcon,
      label: "確定待ち（値が確定してから判定します）",
      text: "確定待ち",
      className: "border border-dashed border-muted-foreground/60 text-muted-foreground",
    };
  }
  if (item.state === "unmeasurable") {
    return {
      Icon: BanIcon,
      label: "反応数を取れない投稿",
      text: "計測できません",
      className: "border border-dashed border-muted-foreground/60 text-muted-foreground",
    };
  }
  if (!item.judgment || item.ratio === null) return null;
  const ratio = formatRatio(item.ratio);
  const Icon = item.judgment === "good" ? TrendingUpIcon : item.judgment === "poor" ? TrendingDownIcon : ArrowRightIcon;
  return {
    Icon,
    label: `${JUDGMENT_LABEL[item.judgment]}（基準値の${ratio}倍）`,
    text: `×${ratio}`,
    className:
      item.judgment === "good"
        ? "bg-perf-good-bg text-perf-good-fg"
        : item.judgment === "poor"
          ? "bg-perf-poor-bg text-perf-poor-fg"
          : "bg-muted text-muted-foreground",
  };
}

/**
 * 判定のバッジ。
 * @param props - item：一覧の項目
 * @returns バッジ。判定がなければ何も出さない
 */
export function JudgmentBadge({ item }: { item: Pick<PerformanceItem, "state" | "judgment" | "ratio"> }) {
  const look = judgmentLook(item);
  if (!look) return null;
  return (
    <span
      title={look.label}
      className={cn("inline-flex h-7 items-center gap-1 rounded-full pr-2.5 pl-1.5 text-sm font-semibold", look.className)}
    >
      <span className="sr-only">{look.label}</span>
      <look.Icon className="size-[18px]" aria-hidden="true" />
      <span aria-hidden="true">{look.text}</span>
    </span>
  );
}

/**
 * タブ・凡例で使う、丸の中のアイコン。
 * @param props - kind：判定か確定待ち、className：大きさなど
 * @returns アイコン
 */
export function JudgmentDot({ kind, className }: { kind: "good" | "normal" | "poor" | "pending"; className?: string }) {
  const Icon =
    kind === "good" ? TrendingUpIcon : kind === "poor" ? TrendingDownIcon : kind === "normal" ? ArrowRightIcon : ClockIcon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full",
        kind === "good" && "bg-perf-good-bg text-perf-good-fg",
        kind === "poor" && "bg-perf-poor-bg text-perf-poor-fg",
        kind === "normal" && "bg-muted text-muted-foreground",
        kind === "pending" && "border border-dashed border-muted-foreground/60 text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

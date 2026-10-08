// 投稿のカード（specs/006-performance-feedback contracts/ui-routes.md「投稿のカード」、FR-016〜FR-018）。
import { PERFORMANCE_MESSAGES, type Metrics, type PerformanceItem } from "@threads-grower/shared";
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { formatJstMonthDay, formatJstShort, formatJstWithWeekday } from "@/lib/format";
import { JudgmentBadge } from "./JudgmentBadge";

const METRIC_LABELS: { key: keyof Metrics; label: string }[] = [
  { key: "views", label: "閲覧" },
  { key: "likes", label: "いいね" },
  { key: "replies", label: "返信" },
  { key: "reposts", label: "リポスト" },
  { key: "quotes", label: "引用" },
  { key: "shares", label: "シェア" },
];

/**
 * 投稿のカード。
 * @param props - item：一覧の項目、headerExtra：1行目に足すもの（次のプロンプトに入るか など）、children：カードの下に足すもの（改善メモ）
 * @returns カード
 */
export function PerformanceCard({
  item,
  headerExtra,
  children,
}: {
  item: PerformanceItem;
  headerExtra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li data-testid={`card-${item.id}`} className="flex flex-col gap-2.5 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
        <JudgmentBadge item={item} />
        <span>{formatJstWithWeekday(item.publishedAt)}</span>
        {headerExtra}
        {item.threadsPermalink && (
          <a
            href={item.threadsPermalink}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex min-h-8 items-center gap-1 hover:text-foreground"
          >
            Threadsで開く
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
      <p className="line-clamp-4 text-[15px] whitespace-pre-line">{item.body}</p>
      {item.metrics && (
        <dl className="grid grid-cols-3 gap-2 border-t pt-2.5 md:grid-cols-6">
          {METRIC_LABELS.map(({ key, label }) => (
            <div key={key} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className={key === "views" ? "text-base font-semibold" : "text-base"}>{item.metrics![key] ?? "−"}</dd>
            </div>
          ))}
        </dl>
      )}
      {item.state === "pending" && item.nextFetchAt && (
        <p className="border-t pt-2.5 text-sm text-muted-foreground">
          反応数は {formatJstShort(item.nextFetchAt)} ごろに取り込みます。
        </p>
      )}
      {item.state === "updating" && item.confirmAt && (
        <p className="text-sm text-muted-foreground">
          暫定の値です。{formatJstMonthDay(item.confirmAt)}ごろ値が確定して判定します。
        </p>
      )}
      {item.state === "late_confirmed" && item.lastElapsedHours !== null && (
        <p className="text-sm text-muted-foreground">
          投稿から{Math.floor(item.lastElapsedHours / 24)}日後に取り込んだ値です（ほかの投稿より長い期間の数のため、基準値には含めません）
        </p>
      )}
      {item.state === "unmeasurable" && (
        <p className="border-t pt-2.5 text-sm text-muted-foreground">{PERFORMANCE_MESSAGES.unmeasurable}</p>
      )}
      {children}
    </li>
  );
}

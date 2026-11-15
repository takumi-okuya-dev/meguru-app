// 受付の1行（specs/collect/001-event-day-collection FR-030〜FR-033・FR-037・FR-039）。
// 未受付：払い方のボタン（高さ44px以上）と「区分・金額」。受付済み：払い方・金額・受け取った人と、取り消せる人には「取り消す」。
// 保存できなかった行：「保存できませんでした・もう一度送る」（保存できるまで受付済みに見せない）。
import { COLLECT_MEDIA_LABELS, RECEPTION_METHOD_LABELS, type ReceptionPerson, type ReceptionRecord } from "@meguru/shared";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { yen } from "../../lib/reception-model";
import type { PendingRecord } from "../../lib/use-reception";

/** 払い方のボタン（イベントで使う払い方と「来場のみ」）。 */
export type PayButton = "cash" | "paypay" | "transfer" | "none";
const PAY_LABELS: Record<PayButton, string> = { cash: "現金", paypay: "PayPay", transfer: "振込", none: "来場のみ" };

/**
 * 受付の1行。
 * @param props - person・record：名簿の人と記録、pending：保存の途中・失敗、buttons：出す払い方、tierLabel：区分と金額の表示、
 *   adjusted：区分・金額を変えているか、receiverName：受け取った人の名前、canUndo：取り消せるか、sameName：同じ名前の人がいる、
 *   canRemove：名簿から外せる、onPay・onAdjust・onRetry・onDiscard・onUndo・onRemove：操作
 * @returns 行
 */
export function ReceptionRow({
  person,
  record,
  pending,
  buttons,
  tierLabel,
  adjusted,
  receiverName,
  canUndo,
  sameName = false,
  canRemove = false,
  tierPending = false,
  onPay,
  onAdjust,
  onRetry,
  onDiscard,
  onUndo,
  onRemove,
}: {
  person: ReceptionPerson;
  record: ReceptionRecord | null;
  pending: PendingRecord | undefined;
  buttons: PayButton[];
  tierLabel: string;
  adjusted: boolean;
  receiverName: string | null;
  canUndo: boolean;
  /** 名簿なしで、同じ名前の人がほかにもいる（specs/collect/004 FR-023） */
  sameName?: boolean;
  /** 名簿なしで入った人で、記録がない（名簿から外せる。FR-024） */
  canRemove?: boolean;
  /** 記録はあるが、区分がまだ決まっていない（確かめ待ち・振込待ち。仮の金額の代わりに「区分を確かめる」と出す） */
  tierPending?: boolean;
  onPay: (button: PayButton) => void;
  onAdjust: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRemove?: () => void;
}) {
  const done = record !== null;
  return (
    <li
      className={cn("flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center", done && "bg-muted/50")}
      aria-label={`No.${person.number} ${person.name}${done ? "（受付済み）" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">No.{person.number}</span>
          <span className="truncate font-medium">{person.name}</span>
          {person.kana && <span className="truncate text-xs text-muted-foreground">{person.kana}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {COLLECT_MEDIA_LABELS[person.media]}・{done ? `${RECEPTION_METHOD_LABELS[record.method]} ${tierPending ? "区分を確かめる" : yen(record.amount)}` : tierLabel}
          {done && receiverName && `・受け取り：${receiverName}`}
          {done && record.paymentStatus === "awaiting_transfer" && "・振込待ち"}
          {done && record.paymentStatus === "awaiting_confirmation" && <span className="font-medium text-amber-700 dark:text-amber-400">・確かめ待ち</span>}
          {sameName && <span className="block font-medium text-amber-700 dark:text-amber-400">同じ名前の人がいます</span>}
          {person.memo && <span className="block truncate">メモ：{person.memo}</span>}
        </div>
      </div>
      {done ? (
        canUndo && (
          <Button type="button" variant="ghost" size="sm" onClick={onUndo}>
            取り消す
          </Button>
        )
      ) : pending?.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <span className="text-sm text-destructive">保存できませんでした</span>
          <Button type="button" className="h-11" onClick={onRetry}>
            もう一度送る
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={onDiscard}>
            やめる
          </Button>
        </div>
      ) : pending?.status === "saving" ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> 保存しています…
        </span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {buttons.map((b) => (
            <Button key={b} type="button" variant={b === "none" ? "outline" : "default"} className="h-11 min-w-16" onClick={() => onPay(b)}>
              {PAY_LABELS[b]}
            </Button>
          ))}
          <Button type="button" variant={adjusted ? "secondary" : "ghost"} className="h-11" onClick={onAdjust}>
            区分・金額
          </Button>
          {canRemove && onRemove && (
            <Button type="button" variant="ghost" className="h-11 text-muted-foreground" onClick={onRemove}>
              名簿から外す
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

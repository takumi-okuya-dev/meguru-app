// 受付の画面の上の数字の段（specs/collect/001-event-day-collection FR-036、data-model.md 4）。
import type { ReceptionStats } from "@meguru/shared";
import { yen } from "../../lib/reception-model";

/**
 * 数字の段：来場・現金・PayPay・振込待ち・あなたが受け取った現金。
 * @param props - stats：数字
 * @returns 数字の段
 */
export function StatsBar({ stats }: { stats: ReceptionStats }) {
  const items = [
    { label: "来場", value: `${stats.arrived} / ${stats.rosterCount}人` },
    { label: "現金", value: yen(stats.cash) },
    { label: "PayPay", value: yen(stats.paypay) },
    { label: "振込待ち", value: `${stats.awaitingTransferCount}件・${yen(stats.awaitingTransferAmount)}` },
    { label: "あなたが受け取った現金", value: yen(stats.mine) },
  ];
  return (
    <dl aria-label="受付の数字" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-base font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

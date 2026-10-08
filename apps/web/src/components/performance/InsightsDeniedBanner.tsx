// 反応数を読む許可がないときの案内（specs/006-performance-feedback research.md R11）。
import { PERFORMANCE_MESSAGES } from "@threads-grower/shared";
import { TriangleAlertIcon } from "lucide-react";
import { ReconnectButton } from "@/components/ReconnectButton";

/**
 * 案内と再接続のボタン。
 * @param props - accountId：AccountのID
 * @returns 案内
 */
export function InsightsDeniedBanner({ accountId }: { accountId: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border bg-warning-bg px-4 py-3 text-sm text-warning">
      <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{PERFORMANCE_MESSAGES.insightsDenied}</p>
      <ReconnectButton accountId={accountId} />
    </div>
  );
}

import type { ConnectionStatus } from "@meguru/shared";
import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon } from "lucide-react";

/**
 * Threads接続の状態のバッジ（接続中・要再接続・未接続。未接続は specs/012 で足した）。
 * @param props - status：Threads接続の状態
 * @returns 状態のバッジ
 */
export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle2Icon className="size-3.5" /> 接続中
      </span>
    );
  }
  if (status === "not_connected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleDashedIcon className="size-3.5" aria-hidden="true" /> 未接続
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
      <AlertTriangleIcon className="size-3.5" /> 要再接続
    </span>
  );
}

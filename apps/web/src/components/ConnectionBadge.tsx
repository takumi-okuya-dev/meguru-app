import type { ConnectionStatus } from "@threads-grower/shared";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle2Icon className="size-3.5" /> 接続中
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
      <AlertTriangleIcon className="size-3.5" /> 要再接続
    </span>
  );
}

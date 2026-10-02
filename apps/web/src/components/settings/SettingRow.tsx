import type { ReactNode } from "react";

/** 設定画面の枠。行は「名前・説明」と「操作」を左右に並べる */
export function SettingCard({ children }: { children: ReactNode }) {
  return <div className="divide-y rounded-xl border bg-card">{children}</div>;
}

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

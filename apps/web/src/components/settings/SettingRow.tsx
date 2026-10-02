import type { ReactNode } from "react";

/**
 * 設定画面の枠。行の間に区切り線を入れる。
 * @param props - children：枠の中の行
 * @returns 設定の枠
 */
export function SettingCard({ children }: { children: ReactNode }) {
  return <div className="divide-y rounded-xl border bg-card">{children}</div>;
}

/**
 * 設定画面の1行。「名前・説明」と「操作」を左右に並べる。
 * @param props - label：名前、description：説明、children：右側の操作
 * @returns 設定の行
 */
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

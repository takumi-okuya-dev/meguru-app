// 上部バー（docs/ui-design.md「2. 画面の骨格」）。画面名と主な操作を、スクロール領域の上端に固定する。
// 767px以下は [≡] 画面名 [主な操作] の3列にし、画面名を中央に置く。
import { MenuIcon, PanelLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

/**
 * 上部バー。サイドバーが出ていないときは、左に開くボタンを出す。下に、骨格から渡されたバナーと toolbar を出す。
 * @param props - title：画面名、actions：右の主な操作、toolbar：バーの下に固定で出すもの（区分のチップなど）
 * @returns 上部バー
 */
export function PageHeader({ title, actions, toolbar }: { title: string; actions?: ReactNode; toolbar?: ReactNode }) {
  const shell = useShell();
  return (
    <div className="sticky top-0 z-20 bg-background">
      <header
        className={cn(
          "grid h-[52px] grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center border-b px-1.5",
          "md:flex md:h-14 md:gap-2 md:px-5",
        )}
      >
        <div className="flex items-center">
          {!shell.sidebarVisible && (
            <Button
              variant="ghost"
              size="icon"
              className="size-11 md:-ml-2 md:size-9"
              aria-label={shell.isWide ? "サイドバーを開く" : "メニューを開く"}
              onClick={shell.openSidebar}
            >
              {shell.isWide ? <PanelLeftIcon className="size-5" /> : <MenuIcon className="size-5" />}
            </Button>
          )}
        </div>
        <h1 className="min-w-0 truncate text-center text-base font-semibold md:flex-1 md:text-left">{title}</h1>
        <div className="flex items-center justify-end gap-2 md:gap-3">{actions}</div>
      </header>
      {toolbar}
      {shell.banner}
    </div>
  );
}

/**
 * 画面の中身の入れ物。中央寄せで、最大幅と左右の余白（PC 32px、スマートフォン 16px）をそろえる。
 * @param props - children：中身、className：追加のクラス
 * @returns 中身の入れ物
 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-3xl px-4 py-6 md:px-8", className)}>{children}</div>;
}

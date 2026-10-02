// 画面の骨格：左サイドバー＋右メインパネル。狭い画面ではサイドバーをドロワーにする
// （contracts/ui-routes.md「レイアウトの骨格」）。後続featureもこの骨格を引き継ぐ。
import { MenuIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";

/**
 * 画面の骨格。左サイドバー＋右メインパネルで、狭い画面ではサイドバーをドロワーにする（contracts/ui-routes.md）。
 * @param props - children：メインパネルの中身
 * @returns 画面の骨格
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:flex md:flex-col">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center border-b px-2 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="メニューを開く">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <Sidebar />
            </SheetContent>
          </Sheet>
          <span className="ml-2 text-sm font-semibold">ThreadsGrower</span>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}

/**
 * サイドバーなしの中央寄せの1カラム。ログイン画面や、Accountが0件のときのアカウント追加画面に使う。
 * @param props - children：中身
 * @returns 中央寄せの骨格
 */
export function CenteredLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center px-4 py-10">{children}</div>;
}

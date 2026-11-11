// 画面の骨格：左サイドバー＋右メインパネル（docs/ui-design.md「2. 画面の骨格」「5. 画面幅ごとの振る舞い」）。
// 1024px以上はサイドバーを常に出して畳める（状態は localStorage）。未満はドロワーで画面の上に重ねて開く。
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EnvBanner } from "./EnvBanner";
import { LG_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { ShellContext, type ShellState } from "./shell-context";
import { Sidebar } from "./Sidebar";
import type { AppSidebar } from "./sidebar-parts";

const COLLAPSED_KEY = "tg.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // 保存できない環境（プライベートブラウズなど）では、この画面の間だけ覚える
  }
}

/**
 * 画面の骨格。左サイドバー＋右メインパネルで、メインパネルの中身は各画面の PageHeader とスクロール領域にする。
 * @param props - children：メインパネルの中身、banner：上部バーの下に出すバナー、sidebar：アプリのサイドバーの中身（specs/028 research.md R8）
 * @returns 画面の骨格
 */
export function AppShell({ children, banner = null, sidebar }: { children: ReactNode; banner?: ReactNode; sidebar?: AppSidebar }) {
  const isWide = useMediaQuery(LG_QUERY);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarVisible = isWide && !collapsed;

  const setCollapsedAndSave = useCallback((value: boolean) => {
    setCollapsed(value);
    writeCollapsed(value);
  }, []);

  const shell = useMemo<ShellState>(
    () => ({
      sidebarVisible,
      isWide,
      openSidebar: () => (isWide ? setCollapsedAndSave(false) : setDrawerOpen(true)),
      banner,
    }),
    [sidebarVisible, isWide, banner, setCollapsedAndSave],
  );

  // 環境は帯ではなく、サイドバーのユーザー名の横の印で示す（UserMenu。帯がずっと出ていると見にくいため）
  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-svh flex-col">
        <div className="flex min-h-0 flex-1">
          {sidebarVisible && (
            <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
              <Sidebar sidebar={sidebar} onCollapse={() => setCollapsedAndSave(true)} />
            </aside>
          )}
          <Sheet open={drawerOpen && !sidebarVisible} onOpenChange={setDrawerOpen}>
            <SheetContent className="w-[19rem] max-w-[85vw]">
              <Sidebar sidebar={sidebar} onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto" data-main-scroll>
            {children}
          </div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

/**
 * サイドバーなしの中央寄せの1カラム。ログイン画面や、Accountが0件のときのアカウント追加画面に使う。
 * @param props - children：中身
 * @returns 中央寄せの骨格
 */
export function CenteredLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <EnvBanner />
      <div className="flex flex-1 items-center justify-center px-4 py-10">{children}</div>
    </div>
  );
}

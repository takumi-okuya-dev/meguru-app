// サイドバーの枠（docs/ui-design.md「2. 画面の骨格」、specs/028-meguru-shell research.md R8）。
// 上から：アプリの頭（Threadsならアカウントの切り替え）と畳むボタン → アプリの中身 → 区切り線 → アプリの下の項目・ユーザーメニュー。
// 中身はアプリが渡す（AppSidebar）。外枠はアプリのコードを読まない。
import { PanelLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppSidebar } from "./sidebar-parts";
import { UserMenu } from "./UserMenu";

/**
 * サイドバーの枠。
 * @param props - sidebar：アプリのサイドバーの中身、onCollapse：畳むボタンの処理（1024px以上のときだけ渡す）、onNavigate：項目を選んだときの処理（ドロワーを閉じる）
 * @returns サイドバー
 */
export function Sidebar({ sidebar, onCollapse, onNavigate }: { sidebar?: AppSidebar; onCollapse?: () => void; onNavigate?: () => void }) {
  const Header = sidebar?.Header;
  const Body = sidebar?.Body;
  const Footer = sidebar?.Footer;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2">
        {Header ? <Header onNavigate={onNavigate} /> : <div className="min-w-0 flex-1" />}
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground"
            aria-label="サイドバーを閉じる"
            onClick={onCollapse}
          >
            <PanelLeftIcon className="size-5" />
          </Button>
        )}
      </div>
      {Body ? <Body onNavigate={onNavigate} /> : <div className="flex-1" />}
      <div className="space-y-0.5 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {Footer && <Footer onNavigate={onNavigate} />}
        <UserMenu />
      </div>
    </div>
  );
}

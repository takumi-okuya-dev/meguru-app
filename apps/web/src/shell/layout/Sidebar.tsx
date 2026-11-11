// サイドバーの枠（docs/ui-design.md「2. 画面の骨格」、specs/028-meguru-shell research.md R8）。
// 上から：アプリの頭（Threadsならアカウントの切り替え）と畳むボタン → アプリの中身 → 区切り線 → アプリの下の項目・ユーザーメニュー。
// 使っているアプリが2本以上の人には、いちばん上の行をアプリの切り替えにし、アプリの頭をその下に出す（contracts/ui-routes.md 5-2）。
// 中身はアプリが渡す（AppSidebar）。外枠はアプリのコードを読まない。
import { useQuery } from "@tanstack/react-query";
import { PanelLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useAppRegistry, useCurrentApp } from "../app-module";
import { AppSwitcher } from "./AppSwitcher";
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
  const apps = useAppRegistry();
  const current = useCurrentApp();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const usingIds = me.data?.apps?.using ?? [];
  const using = apps.filter((a) => usingIds.includes(a.id));
  // アプリが1本以下の人には出さない（今のThreadsアプリと同じ見た目のまま。spec FR-005・FR-018）
  const showSwitcher = Boolean(current) && using.length >= 2;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2">
        {showSwitcher && current ? (
          <AppSwitcher current={current} using={using} onNavigate={onNavigate} />
        ) : Header ? (
          <Header onNavigate={onNavigate} />
        ) : (
          <div className="min-w-0 flex-1" />
        )}
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
      {showSwitcher && Header && (
        <div className="flex items-center gap-1 px-2 pb-1">
          <Header onNavigate={onNavigate} />
        </div>
      )}
      {Body ? <Body onNavigate={onNavigate} /> : <div className="flex-1" />}
      <div className="space-y-0.5 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {Footer && <Footer onNavigate={onNavigate} />}
        <UserMenu />
      </div>
    </div>
  );
}

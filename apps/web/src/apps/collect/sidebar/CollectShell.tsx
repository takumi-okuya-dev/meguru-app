// 集金管理のサイドバーの中身と画面の骨格（specs/collect/001-event-day-collection contracts/ui-routes.md 1、tasks.md T018）。
// 上から：アプリの名前 → イベント・イベントを作る・振込待ち（数）・まとめ → 下に このアプリの設定。
// 開いているイベントの画面（名簿・受付・受付の手伝い・セルフ受付・締め・分配）は、メインパネルの下のタブバー（EventTabBar.tsx）で切り替える。
import { appById } from "@meguru/shared";
import { useQuery } from "@tanstack/react-query";
import { ArchiveIcon, BanknoteIcon, CalendarPlusIcon, CalendarDaysIcon, SlidersHorizontalIcon, WalletIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { AppShell, type AppSidebar, type SidebarPartProps } from "@/shell";
import { cn } from "@/lib/utils";
import { collectApi } from "../lib/api";
import { collectSettingsPath, eventsPath, newEventPath, summariesPath, transfersPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";
import { EventTabBar, useOpenEventId } from "./EventTabBar";

const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn("flex h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent lg:h-9 lg:gap-2.5 lg:px-2.5", isActive && "bg-accent font-medium");

/**
 * いちばん上の行：アプリの名前。
 * @returns アプリの名前
 */
function Header() {
  return (
    <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 px-2.5 text-sm font-medium">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
        <WalletIcon className="size-4" aria-hidden="true" />
      </span>
      <span className="truncate">{appById("collect")?.name ?? "集金"}</span>
    </div>
  );
}

/**
 * 中身：アプリ全体の項目（イベント・作る・振込待ち・まとめ）。イベントの中の画面は、画面の下のタブバー（EventTabBar）で切り替える。
 * イベントの中の画面にいる間は「イベント」を選んだ状態にする。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns サイドバーの中身
 */
function Body({ onNavigate }: SidebarPartProps) {
  const openEventId = useOpenEventId();
  const me = useQuery({ queryKey: collectQueryKeys.me, queryFn: collectApi.me });
  const awaiting = me.data?.awaitingTransferCount ?? 0;
  return (
    <nav aria-label="集金管理" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
      <NavLink to={eventsPath()} end className={({ isActive }) => itemClass({ isActive: isActive || Boolean(openEventId) })} onClick={onNavigate}>
        <CalendarDaysIcon className="size-5 lg:size-[18px]" /> イベント
      </NavLink>
      <NavLink to={newEventPath()} className={itemClass} onClick={onNavigate}>
        <CalendarPlusIcon className="size-5 lg:size-[18px]" /> イベントを作る
      </NavLink>
      <NavLink to={transfersPath()} className={itemClass} onClick={onNavigate}>
        <BanknoteIcon className="size-5 lg:size-[18px]" /> 振込待ち
        {awaiting > 0 && (
          <span className="ml-auto rounded-full bg-primary px-2 text-xs text-primary-foreground tabular-nums" aria-label={`${awaiting}件`}>
            {awaiting}
          </span>
        )}
      </NavLink>
      <NavLink to={summariesPath()} className={itemClass} onClick={onNavigate}>
        <ArchiveIcon className="size-5 lg:size-[18px]" /> まとめ
      </NavLink>
    </nav>
  );
}

/**
 * 下の項目：このアプリの設定（PayPay の受け取り用 QR・振込先の案内）。Threads の「このアカウントの設定」とそろえる。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns 設定への移動
 */
function Footer({ onNavigate }: SidebarPartProps) {
  return (
    <NavLink to={collectSettingsPath()} className={itemClass} onClick={onNavigate}>
      <SlidersHorizontalIcon className="size-5 lg:size-[18px]" /> このアプリの設定
    </NavLink>
  );
}

/** 集金管理のサイドバーの中身。 */
export const collectSidebar: AppSidebar = { Header, Body, Footer };

/**
 * 集金管理の画面の骨格（外枠の骨格に、集金管理のサイドバーと、イベントの画面の下のタブバーを入れたもの）。
 * @param props - children：メインパネルの中身
 * @returns 画面の骨格
 */
export function CollectShell({ children }: { children: ReactNode }) {
  return (
    <AppShell sidebar={collectSidebar}>
      {children}
      <EventTabBar />
    </AppShell>
  );
}

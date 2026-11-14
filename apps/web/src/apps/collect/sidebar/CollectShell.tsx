// 集金管理のサイドバーの中身と画面の骨格（specs/collect/001-event-day-collection contracts/ui-routes.md 1、tasks.md T018）。
// 上から：アプリの名前 → イベント・イベントを作る・振込待ち（数）・まとめ → 開いているイベント（名簿・受付・受付の手伝い・セルフ受付・締め）→ 下に PayPay・振込先の設定。
import { appById } from "@meguru/shared";
import { useQuery } from "@tanstack/react-query";
import { ArchiveIcon, BanknoteIcon, CalendarPlusIcon, CalendarDaysIcon, ClipboardCheckIcon, ListChecksIcon, QrCodeIcon, ScanLineIcon, SettingsIcon, UsersIcon, WalletIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useMatch } from "react-router";
import { AppShell, type AppSidebar, type SidebarPartProps } from "@/shell";
import { cn } from "@/lib/utils";
import { collectApi } from "../lib/api";
import {
  COLLECT_BASE,
  closingPath,
  collectSettingsPath,
  eventsPath,
  helpersPath,
  newEventPath,
  receptionPath,
  rosterPath,
  selfCheckInPath,
  summariesPath,
  transfersPath,
} from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";

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
 * 中身：イベントの一覧・作る・開いているイベントの画面。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns サイドバーの中身
 */
function Body({ onNavigate }: SidebarPartProps) {
  const eventId = useMatch(`${COLLECT_BASE}/events/:eventId/*`)?.params.eventId;
  const openEventId = eventId && eventId !== "new" ? eventId : undefined;
  const event = useQuery({
    queryKey: collectQueryKeys.event(openEventId ?? ""),
    queryFn: () => collectApi.event(openEventId!),
    enabled: Boolean(openEventId),
  });
  const me = useQuery({ queryKey: collectQueryKeys.me, queryFn: collectApi.me });
  const awaiting = me.data?.awaitingTransferCount ?? 0;
  return (
    <nav aria-label="集金管理" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
      <NavLink to={eventsPath()} end className={itemClass} onClick={onNavigate}>
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
      {openEventId && (
        <div className="space-y-0.5">
          <div className="truncate px-3 pt-4 pb-1 text-xs text-muted-foreground lg:px-2.5">{event.data?.name ?? "開いているイベント"}</div>
          <NavLink to={rosterPath(openEventId)} className={itemClass} onClick={onNavigate}>
            <ListChecksIcon className="size-5 lg:size-[18px]" /> 名簿
          </NavLink>
          <NavLink to={receptionPath(openEventId)} className={itemClass} onClick={onNavigate}>
            <ScanLineIcon className="size-5 lg:size-[18px]" /> 受付
          </NavLink>
          <NavLink to={helpersPath(openEventId)} className={itemClass} onClick={onNavigate}>
            <UsersIcon className="size-5 lg:size-[18px]" /> 受付の手伝い
          </NavLink>
          <NavLink to={selfCheckInPath(openEventId)} className={itemClass} onClick={onNavigate}>
            <QrCodeIcon className="size-5 lg:size-[18px]" /> セルフ受付
          </NavLink>
          <NavLink to={closingPath(openEventId)} className={itemClass} onClick={onNavigate}>
            <ClipboardCheckIcon className="size-5 lg:size-[18px]" /> 締め
          </NavLink>
        </div>
      )}
    </nav>
  );
}

/**
 * 下の項目：PayPay・振込先の設定。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns 設定への移動
 */
function Footer({ onNavigate }: SidebarPartProps) {
  return (
    <NavLink to={collectSettingsPath()} className={itemClass} onClick={onNavigate}>
      <SettingsIcon className="size-5 lg:size-[18px]" /> PayPay・振込先の設定
    </NavLink>
  );
}

/** 集金管理のサイドバーの中身。 */
export const collectSidebar: AppSidebar = { Header, Body, Footer };

/**
 * 集金管理の画面の骨格（外枠の骨格に、集金管理のサイドバーを入れたもの）。
 * @param props - children：メインパネルの中身
 * @returns 画面の骨格
 */
export function CollectShell({ children }: { children: ReactNode }) {
  return <AppShell sidebar={collectSidebar}>{children}</AppShell>;
}

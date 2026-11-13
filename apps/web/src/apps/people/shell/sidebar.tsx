// 人物メモのサイドバーの中身（specs/people/001-people-memo contracts/ui-routes.md 1、specs/028 research.md R8）。
// 外枠のサイドバーの枠に、頭（アプリの名前）と中身（誘う候補・取り込み・イベント）を渡す。まだない画面の項目は出さない。
import { ContactIcon } from "lucide-react";
import { NavLink } from "react-router";
import type { AppSidebar, SidebarPartProps } from "@/shell";
import { cn } from "@/lib/utils";
import { PEOPLE_NAV_ITEMS } from "./nav-items";

/**
 * 項目の見た目。
 * @param state - isActive：今いる画面か
 * @returns クラス
 */
const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent lg:h-9 lg:gap-2.5 lg:px-2.5",
    isActive && "bg-accent font-medium",
  );

/**
 * サイドバーの頭：アプリの名前。
 * @returns アプリの名前
 */
function Header() {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm font-semibold">
      <ContactIcon className="size-5 shrink-0" aria-hidden="true" />
      <span className="truncate">人物メモ</span>
    </div>
  );
}

/**
 * サイドバーの中身：画面の移動。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns サイドバーの中身
 */
function Body({ onNavigate }: SidebarPartProps) {
  return (
    <nav aria-label="人物メモ" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
      {PEOPLE_NAV_ITEMS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={itemClass} onClick={onNavigate}>
          <Icon className="size-5 lg:size-[18px]" /> {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** 人物メモのサイドバーの中身。 */
export const peopleSidebar: AppSidebar = { Header, Body };

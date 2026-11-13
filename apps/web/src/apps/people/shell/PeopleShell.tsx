// 人物メモの画面の枠（specs/people/001-people-memo contracts/ui-routes.md 1、research.md R20）。
// 外枠の AppShell に人物メモのサイドバーを渡し、幅767px以下では中身の下に固定の下のバーを出す（外枠は直さない）。
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { AppShell } from "@/shell";
import { MD_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { PEOPLE_NAV_ITEMS } from "./nav-items";
import { peopleSidebar } from "./sidebar";

/**
 * 下のバー（767px以下）。アイコンと短い名前を並べ、今いる画面を濃く出す。押すところは44px以上、下の安全な余白をとる。
 * @returns 下のバー
 */
export function PeopleBottomBar() {
  return (
    <nav
      aria-label="人物メモのメニュー"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex h-14">
        {PEOPLE_NAV_ITEMS.map(({ to, shortLabel, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex h-full min-h-11 flex-col items-center justify-center gap-0.5 text-[11px]",
                  isActive ? "font-semibold text-foreground" : "text-muted-foreground",
                )
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              {shortLabel}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * 人物メモの画面の枠。
 * @param props - children：メインパネルの中身
 * @returns 画面の枠
 */
export function PeopleShell({ children }: { children: ReactNode }) {
  const isWide = useMediaQuery(MD_QUERY);
  return (
    <AppShell sidebar={peopleSidebar}>
      {children}
      {!isWide && (
        <>
          {/* 下のバーの分だけ、中身の下に余白をとる（最後の行が隠れない） */}
          <div aria-hidden="true" className="h-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0" />
          <PeopleBottomBar />
        </>
      )}
    </AppShell>
  );
}

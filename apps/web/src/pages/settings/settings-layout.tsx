// 設定画面の骨格（contracts/ui-routes.md）：左に「アプリに戻る」・検索・項目の一覧、右に項目の中身
import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SETTINGS_GROUPS, filterSettingsGroups } from "./sections";

export function SettingsLayout() {
  const [query, setQuery] = useState("");
  const groups = filterSettingsGroups(SETTINGS_GROUPS, query);

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="shrink-0 border-b bg-sidebar md:w-64 md:border-r md:border-b-0">
        <div className="space-y-3 p-3">
          <Link to="/" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            <ArrowLeftIcon className="size-4" /> アプリに戻る
          </Link>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="検索"
              aria-label="設定を検索"
              className="rounded-full pl-8"
            />
          </div>
        </div>
        <nav aria-label="設定" className="space-y-4 px-3 pb-3">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2 pb-1 text-xs text-muted-foreground">{g.label}</div>
              <ul className="space-y-0.5">
                {g.sections.map(({ slug, label, Icon }) => (
                  <li key={slug}>
                    <NavLink
                      to={`/settings/${slug}`}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                          isActive && "bg-accent font-medium",
                        )
                      }
                    >
                      <Icon className="size-4" /> {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="px-2 text-sm text-muted-foreground">該当する設定はありません</p>}
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}

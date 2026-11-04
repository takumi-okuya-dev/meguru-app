// 設定画面の骨格（docs/ui-design.md 型D）。
// 768px以上：左に「アプリに戻る」・検索・項目の一覧、右に項目の中身（ChatGPTの設定画面と同じ2列）。
// 767px以下：「項目の一覧の画面」→「項目の中身の画面（左上に「← 設定」）」の2段。
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useMatch } from "react-router";
import { TrialEndingBannerFromMe } from "@/components/billing/TrialEndingBanner";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { MD_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { DEFAULT_SETTINGS_SLUG, filterSettingsGroups, settingsGroupsFor, type SettingsGroup } from "./sections";

function SearchBox({
  query,
  onChange,
  className,
}: {
  query: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="検索"
        aria-label="設定を検索"
        className="h-10 rounded-full border-0 bg-muted pl-9 text-base md:h-9 md:text-sm"
      />
    </div>
  );
}

function MobileHeader({ back, title }: { back: React.ReactNode; title: string }) {
  return (
    <header className="sticky top-0 z-20 grid h-[52px] grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center bg-sidebar px-1.5">
      <div>{back}</div>
      <h1 className="truncate text-center text-base font-semibold">{title}</h1>
      <span />
    </header>
  );
}

function MobileList({
  groups,
  query,
  onQuery,
}: {
  groups: SettingsGroup[];
  query: string;
  onQuery: (v: string) => void;
}) {
  return (
    <div className="min-h-svh bg-sidebar">
      <MobileHeader
        title="設定"
        back={
          <Link
            to="/"
            aria-label="アプリに戻る"
            className="flex size-11 items-center justify-center rounded-lg hover:bg-accent"
          >
            <ArrowLeftIcon className="size-5" />
          </Link>
        }
      />
      <div className="space-y-5 px-4 pt-1 pb-8">
        <SearchBox query={query} onChange={onQuery} />
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-1 pb-1.5 text-[13px] text-muted-foreground">{g.label}</div>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {g.sections.map(({ slug, label, Icon }) => (
                <li key={slug}>
                  <Link
                    to={`/settings/${slug}`}
                    className="flex min-h-[52px] items-center gap-3 px-3.5 hover:bg-accent"
                  >
                    <Icon className="size-5" />
                    <span className="flex-1">{label}</span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">該当する設定はありません</p>
        )}
      </div>
    </div>
  );
}

/**
 * 設定画面の骨格（docs/ui-design.md 型D）。768px以上は2列、767px以下は「一覧 → 中身」の2段にする。
 * @returns 設定画面
 */
export function SettingsLayout() {
  const isWide = useMediaQuery(MD_QUERY);
  const atIndex = useMatch("/settings") !== null;
  const location = useLocation();
  const [query, setQuery] = useState("");
  // 運営者には「運営」の区分を出す（specs/016 contracts/ui-routes.md 3）
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const allGroups = settingsGroupsFor(Boolean(me.data?.operator));
  const groups = filterSettingsGroups(allGroups, query);

  if (!isWide) {
    if (atIndex) return <MobileList groups={groups} query={query} onQuery={setQuery} />;
    const slug = location.pathname.split("/")[2];
    const current = allGroups.flatMap((g) => g.sections).find((s) => s.slug === slug);
    return (
      <div className="min-h-svh">
        <MobileHeader
          title={current?.label ?? "設定"}
          back={
            <Link
              to="/settings"
              className="flex h-11 items-center gap-0.5 rounded-lg pr-2 pl-1 hover:bg-accent"
            >
              <ChevronLeftIcon className="size-5" />
              設定
            </Link>
          }
        />
        <main className="px-4 pt-2 pb-8">
          <div className="mb-4 overflow-hidden rounded-2xl empty:hidden">
            <TrialEndingBannerFromMe />
          </div>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <div className="flex flex-1">
        <aside className="w-64 shrink-0 border-r bg-sidebar">
          <div className="space-y-3 p-3">
            <Link
              to="/"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
            >
              <ArrowLeftIcon className="size-4" /> アプリに戻る
            </Link>
            <SearchBox query={query} onChange={setQuery} />
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
                            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent",
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
            {groups.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">該当する設定はありません</p>
            )}
          </nav>
        </aside>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-8 md:py-10">
          <div className="mb-6 overflow-hidden rounded-2xl empty:hidden">
            <TrialEndingBannerFromMe />
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * /settings を開いたとき。768px以上は最初の項目へ移り、767px以下は一覧（SettingsLayout が描く）のままにする。
 * @returns 移動、または何も描かない
 */
export function SettingsIndex() {
  const isWide = useMediaQuery(MD_QUERY);
  return isWide ? <Navigate to={DEFAULT_SETTINGS_SLUG} replace /> : null;
}

// パートナーの画面の骨格（specs/008-team-operations contracts/ui-routes.md「ルート」、docs/ui-design.md 型D）。
// 768px以上：左に「アプリに戻る」と項目の一覧、右に中身。767px以下：「一覧 → 中身」の2段。
// UI全体設計の「専用のダッシュボード画面は作らない」の例外（spec FR-060、2026-10-09決定）。
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, LayoutGridIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { Link, Navigate, NavLink, Outlet, useLocation, useMatch } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { MD_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

type PartnerSection = { slug: "accounts" | "editors"; label: string; Icon: LucideIcon };
const SECTIONS: PartnerSection[] = [
  { slug: "accounts", label: "手伝っているアカウント", Icon: LayoutGridIcon },
  { slug: "editors", label: "編集者と担当", Icon: UsersIcon },
];

/**
 * 担当未定の人数（「編集者と担当」の右に出す。FR-047(2)）。
 * @param props - n：人数
 * @returns 表示
 */
function Unassigned({ n }: { n: number }) {
  if (n === 0) return null;
  return <span className="ml-auto text-xs text-muted-foreground">担当未定 {n}人</span>;
}

/**
 * パートナーの画面の骨格。チームのパートナーでなければ `/` へ移す。
 * @returns 画面
 */
export function PartnerLayout() {
  const isWide = useMediaQuery(MD_QUERY);
  const atIndex = useMatch("/partner") !== null;
  const location = useLocation();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  if (me.isPending) return <LoadingSkeleton />;
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  const team = me.data.partnerTeam;
  if (!team) return <Navigate to="/" replace />;
  if (atIndex && isWide) return <Navigate to="/partner/accounts" replace />;
  const heading = `パートナー · ${team.name ?? me.data.user.displayName ?? ""}`;
  const unassigned = team.unassignedEditorCount;

  if (!isWide) {
    const back = "flex size-11 items-center justify-center rounded-lg hover:bg-accent";
    if (atIndex) {
      return (
        <div className="min-h-svh bg-sidebar">
          <header className="sticky top-0 z-20 grid h-[52px] grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center bg-sidebar px-1.5">
            <Link to="/" aria-label="アプリに戻る" className={back}>
              <ArrowLeftIcon className="size-5" />
            </Link>
            <h1 className="truncate text-center text-base font-semibold">{heading}</h1>
            <span />
          </header>
          <ul className="mx-4 mt-2 divide-y overflow-hidden rounded-2xl border bg-card">
            {SECTIONS.map(({ slug, label, Icon }) => (
              <li key={slug}>
                <Link to={`/partner/${slug}`} className="flex min-h-[52px] items-center gap-3 px-3.5 hover:bg-accent">
                  <Icon className="size-5" />
                  <span className="flex-1">{label}</span>
                  {slug === "editors" && <Unassigned n={unassigned} />}
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    const current = SECTIONS.find((s) => location.pathname.endsWith(`/${s.slug}`));
    return (
      <div className="min-h-svh">
        <header className="sticky top-0 z-20 grid h-[52px] grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center bg-background px-1.5">
          <Link to="/partner" className="flex h-11 items-center gap-0.5 rounded-lg pr-2 pl-1 hover:bg-accent">
            <ChevronLeftIcon className="size-5" />
            パートナー
          </Link>
          <h1 className="truncate text-center text-base font-semibold">{current?.label ?? ""}</h1>
          <span />
        </header>
        <main className="px-4 pt-2 pb-8">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh">
      <aside className="w-64 shrink-0 border-r bg-sidebar">
        <div className="p-3">
          <Link to="/" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
            <ArrowLeftIcon className="size-4" /> アプリに戻る
          </Link>
        </div>
        <nav aria-label="パートナー" className="px-3 pb-3">
          <div className="px-2 pb-1 text-xs text-muted-foreground">{heading}</div>
          <ul className="space-y-0.5">
            {SECTIONS.map(({ slug, label, Icon }) => (
              <li key={slug}>
                <NavLink
                  to={`/partner/${slug}`}
                  className={({ isActive }) =>
                    cn("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-accent", isActive && "bg-accent font-medium")
                  }
                >
                  <Icon className="size-[18px]" />
                  {label}
                  {slug === "editors" && <Unassigned n={unassigned} />}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

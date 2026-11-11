// Threadsのサイドバーの中身（docs/ui-design.md「2. 画面の骨格」、specs/028-meguru-shell research.md R8）。
// 外枠のサイドバーの枠に、頭（アカウントの切り替え）・中身（担当の案内・機能の移動・チーム）・下の項目（このアカウントの設定）を渡す。
// まだ作っていない機能は出さない（各featureで画面を作ったときに NAV_GROUPS に足す）。
// 「チーム」の見出しの下に、入っているチームの名前を並べる（specs/011 contracts/ui-routes.md「サイドバー」）。
// チームに入っていない人には、チームのものを何も出さない（Constitution原則V）。
import {
  ChartColumnIcon,
  ChartLineIcon,
  HistoryIcon,
  HouseIcon,
  InboxIcon,
  MegaphoneIcon,
  PlusIcon,
  SearchIcon,
  Share2Icon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react";
import type { Feature } from "@meguru/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, NavLink, useMatch, useParams } from "react-router";
import { AppShell, Sidebar, type AppSidebar, type SidebarPartProps } from "@/shell";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { CreateTeamDialog } from "../components/team/CreateTeamDialog";
import { TeamMark } from "../components/team/TeamMark";
import { featureOn, useAccountAccess } from "../lib/use-account-access";
import { AccountSwitcher } from "./AccountSwitcher";

type NavItem = { path: string; label: string; Icon: LucideIcon; end?: boolean; badge?: "needsReview"; needsAccount?: boolean };
/** feature：区分ごとON/OFFする機能のまとまり。OFFなら見出しごと出さない（specs/019 FR-004） */
type NavGroup = { label?: string; items: NavItem[]; feature?: Feature };

/** 機能の移動。path は /accounts/:id からの相対パス。 */
// 並びは ホーム → 自動投稿 → 戦略 → チーム（specs/019 FR-004。2026-11-04に「分析」の見出しをなくし、パフォーマンスを自動投稿に入れた）
const NAV_GROUPS: NavGroup[] = [
  { items: [{ path: "", label: "ホーム", Icon: HouseIcon, end: true }] },
  {
    label: "自動投稿",
    feature: "autopost",
    items: [
      // 「投稿をつくる」の画面へ移る。開いている間は選ばれた見た目にする（specs/014 FR-160）。Accountがないと開けないので出さない
      { path: "create", label: "投稿をつくる", Icon: SquarePenIcon, needsAccount: true },
      { path: "stock", label: "投稿ストック", Icon: InboxIcon, badge: "needsReview" },
      { path: "performance", label: "パフォーマンス", Icon: ChartColumnIcon },
      { path: "analysis", label: "解析", Icon: ChartLineIcon },
    ],
  },
  {
    label: "戦略",
    feature: "strategy",
    items: [
      { path: "strategy", label: "課題", Icon: TargetIcon },
      { path: "promotions", label: "宣伝内容", Icon: MegaphoneIcon },
      { path: "external-media", label: "外部媒体展開", Icon: Share2Icon },
      { path: "research", label: "リサーチ", Icon: SearchIcon },
    ],
  },
];

const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent lg:h-9 lg:gap-2.5 lg:px-2.5",
    isActive && "bg-accent font-medium",
  );

/**
 * サイドバーで扱うアカウント。チームの画面（/teams/*）では、最後に使ったAccountの機能へ移れるようにする。
 * @returns 表示中（なければ最後に使った）アカウントのIDと、その画面のURLの頭
 */
function useSidebarAccount() {
  const params = useParams<{ accountId: string }>();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const accountId = params.accountId ?? me.data?.landingAccountId ?? undefined;
  const base = accountId ? `/accounts/${accountId}` : "/";
  return { me, params, accountId, base };
}

/**
 * サイドバーの頭：アカウントの切り替え。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns アカウントの切り替え
 */
function Header({ onNavigate }: SidebarPartProps) {
  return <AccountSwitcher onNavigate={onNavigate} />;
}

/**
 * サイドバーの中身：担当の案内・機能の移動・チーム・操作の記録。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns サイドバーの中身
 */
function Body({ onNavigate }: SidebarPartProps) {
  const { me, params, accountId, base } = useSidebarAccount();
  const teams = me.data?.teams ?? [];
  const openTeam = useMatch("/teams/:teamId/*")?.params.teamId;
  const [creating, setCreating] = useState(false);
  // 投稿ストックの右に出す要確認の件数（specs/004 FR-013）。本文を含まない軽いAPIで読む
  // 機能の移動と同じく、チームの画面では最後に使ったAccountで読む（でないと「操作の記録」が消える）
  const { access, isPending: accessPending } = useAccountAccess(accountId);
  const autopostOn = featureOn(access, "autopost");
  const counts = useQuery({
    queryKey: queryKeys.draftCounts(accountId ?? ""),
    queryFn: () => api.getDraftCounts(accountId!),
    // 自動投稿を使えないAccountでは、投稿ストックを出さないので読まない。使えるかがわかってから読む（specs/019）
    enabled: !!accountId && !accessPending && autopostOn,
  });
  // チームの区分は、自分とAccountのオーナーの両方がチームを使えるときだけ（specs/019 FR-009・FR-012）
  const teamOn = (me.data?.features.includes("team") ?? true) && featureOn(access, "team");
  return (
    <>
      {params.accountId && access?.relation === "assigned" && (
        // 担当の人に、自分の立場とオーナーを示す（specs/011 T025）。オーナーには出さない
        <div className="mx-3 mb-1 rounded-xl border bg-background px-3 py-2 text-xs leading-snug">
          <div className="font-medium">担当しています</div>
          <div className="text-muted-foreground">オーナー：{access.owner.name}</div>
        </div>
      )}
      <nav aria-label="このアカウント" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {NAV_GROUPS.filter((group) => !group.feature || featureOn(access, group.feature)).map((group, i) => (
          <div key={group.label ?? i} className="space-y-0.5">
            {group.label && <div className="px-3 pt-4 pb-1 text-xs text-muted-foreground lg:px-2.5">{group.label}</div>}
            {group.items.filter((item) => accountId || !item.needsAccount).map(({ path, label, Icon, end, badge }) => {
              const n = badge ? (counts.data?.[badge] ?? 0) : 0;
              return (
                <NavLink key={label} to={path ? `${base}/${path}` : base} end={end} className={itemClass} onClick={onNavigate}>
                  <Icon className="size-5 lg:size-[18px]" /> {label}
                  {n > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      <span aria-hidden="true">{n}</span>
                      <span className="sr-only">（要確認 {n}件）</span>
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
        {teamOn && (teams.length > 0 || (access?.hasTeam && access.permissions.includes("activity"))) && (
          <div className="space-y-0.5">
            <div className="px-3 pt-4 pb-1 text-xs text-muted-foreground lg:px-2.5">チーム</div>
            {teams.map((t) => (
              <Link
                key={t.id}
                to={`/teams/${t.id}`}
                aria-current={openTeam === t.id ? "page" : undefined}
                className={itemClass({ isActive: openTeam === t.id })}
                onClick={onNavigate}
              >
                <TeamMark name={t.name} className="size-5 text-[11px] lg:size-[18px]" />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{t.memberCount}人</span>
              </Link>
            ))}
            {teams.some((t) => t.role === "admin") && (
              // どれかのチームの管理者には「チームを作る」も出す（FR-050）。ほかの人は、このアカウントの設定から作る
              <button type="button" className={cn(itemClass({ isActive: false }), "w-full text-left text-muted-foreground")} onClick={() => setCreating(true)}>
                <PlusIcon className="size-5 lg:size-[18px]" /> チームを作る
              </button>
            )}
            {access?.hasTeam && access.permissions.includes("activity") && (
              // チームに入っているAccountで、オーナーと担当の管理者だけ（specs/008 FR-052、specs/011 FR-002）
              <NavLink to={`${base}/activity`} className={itemClass} onClick={onNavigate}>
                <HistoryIcon className="size-5 lg:size-[18px]" /> 操作の記録
              </NavLink>
            )}
          </div>
        )}
      </nav>
      {creating && <CreateTeamDialog onClose={() => setCreating(false)} onCreated={() => onNavigate?.()} />}
    </>
  );
}

/**
 * サイドバーの下の項目：このアカウントの設定。
 * @param props - onNavigate：項目を選んだときの処理
 * @returns このアカウントの設定への移動（アカウントがなければ何も出さない）
 */
function Footer({ onNavigate }: SidebarPartProps) {
  const { accountId, base } = useSidebarAccount();
  if (!accountId) return null;
  return (
    <NavLink to={`${base}/settings`} className={itemClass} onClick={onNavigate}>
      <SlidersHorizontalIcon className="size-5 lg:size-[18px]" /> このアカウントの設定
    </NavLink>
  );
}

/** Threadsのサイドバーの中身。 */
export const threadsSidebar: AppSidebar = { Header, Body, Footer };

/**
 * Threadsの画面の骨格（外枠の骨格に、Threadsのサイドバーを入れたもの）。
 * @param props - children：メインパネルの中身、banner：上部バーの下に出すバナー
 * @returns 画面の骨格
 */
export function ThreadsShell({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <AppShell sidebar={threadsSidebar} banner={banner}>
      {children}
    </AppShell>
  );
}

/**
 * Threadsのサイドバー（外枠の枠に、Threadsの中身を入れたもの）。
 * @param props - onCollapse：畳むボタンの処理、onNavigate：項目を選んだときの処理
 * @returns サイドバー
 */
export function ThreadsSidebar({ onCollapse, onNavigate }: { onCollapse?: () => void; onNavigate?: () => void }) {
  return <Sidebar sidebar={threadsSidebar} onCollapse={onCollapse} onNavigate={onNavigate} />;
}

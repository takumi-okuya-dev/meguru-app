// サイドバーの中身（docs/ui-design.md「2. 画面の骨格」）。
// 上から：Accountの切り替えと畳むボタン → 機能の移動（ホーム・投稿をつくる・投稿ストック…） → チーム → 区切り線 → このアカウントの設定・ユーザーメニュー。
// まだ作っていない機能は出さない（各featureで画面を作ったときに NAV_GROUPS に足す）。
// 「チーム」の見出しの下に、入っているチームの名前を並べる（specs/011 contracts/ui-routes.md「サイドバー」）。
// チームに入っていない人には、チームのものを何も出さない（Constitution原則V）。
import {
  ChartColumnIcon,
  HistoryIcon,
  HouseIcon,
  InboxIcon,
  MegaphoneIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react";
import type { Feature } from "@threads-grower/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, useMatch, useParams } from "react-router";
import { CreateTeamDialog } from "@/components/team/CreateTeamDialog";
import { TeamMark } from "@/components/team/TeamMark";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { featureOn, useAccountAccess } from "@/lib/use-account-access";
import { cn } from "@/lib/utils";
import { AccountSwitcher } from "./AccountSwitcher";
import { UserMenu } from "./UserMenu";

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
    ],
  },
  {
    label: "戦略",
    feature: "strategy",
    items: [
      { path: "strategy", label: "課題", Icon: TargetIcon },
      { path: "promotions", label: "宣伝内容", Icon: MegaphoneIcon },
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
 * サイドバーの中身。
 * @param props - onCollapse：畳むボタンの処理（1024px以上のときだけ渡す）、onNavigate：項目を選んだときの処理（ドロワーを閉じる）
 * @returns サイドバー
 */
export function Sidebar({ onCollapse, onNavigate }: { onCollapse?: () => void; onNavigate?: () => void }) {
  const params = useParams<{ accountId: string }>();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  // チームの画面（/teams/*）では、最後に使ったAccountの機能へ移れるようにする
  const accountId = params.accountId ?? me.data?.landingAccountId ?? undefined;
  const base = accountId ? `/accounts/${accountId}` : "/";
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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2">
        <AccountSwitcher onNavigate={onNavigate} />
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
      <div className="space-y-0.5 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {accountId && (
          <NavLink to={`${base}/settings`} className={itemClass} onClick={onNavigate}>
            <SlidersHorizontalIcon className="size-5 lg:size-[18px]" /> このアカウントの設定
          </NavLink>
        )}
        <UserMenu />
      </div>
      {creating && <CreateTeamDialog onClose={() => setCreating(false)} onCreated={() => onNavigate?.()} />}
    </div>
  );
}

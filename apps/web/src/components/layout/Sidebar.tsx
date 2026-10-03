// サイドバーの中身（docs/ui-design.md「2. 画面の骨格」）。
// 上から：Accountの切り替えと畳むボタン → 機能の移動 → 区切り線 → このアカウントの設定・ユーザーメニュー。
// まだ作っていない機能は出さない（各featureで画面を作ったときに NAV_GROUPS に足す）。
import { HouseIcon, PanelLeftIcon, SlidersHorizontalIcon, TargetIcon, type LucideIcon } from "lucide-react";
import { NavLink, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AccountSwitcher } from "./AccountSwitcher";
import { UserMenu } from "./UserMenu";

type NavItem = { path: string; label: string; Icon: LucideIcon; end?: boolean };
type NavGroup = { label?: string; items: NavItem[] };

/** 機能の移動。path は /accounts/:id からの相対パス。 */
const NAV_GROUPS: NavGroup[] = [
  { items: [{ path: "", label: "ホーム", Icon: HouseIcon, end: true }] },
  { label: "戦略", items: [{ path: "strategy", label: "課題", Icon: TargetIcon }] },
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
  const { accountId } = useParams<{ accountId: string }>();
  const base = accountId ? `/accounts/${accountId}` : "/";
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
      <nav aria-label="このアカウント" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {NAV_GROUPS.map((group, i) => (
          <div key={group.label ?? i} className="space-y-0.5">
            {group.label && <div className="px-3 pt-4 pb-1 text-xs text-muted-foreground lg:px-2.5">{group.label}</div>}
            {group.items.map(({ path, label, Icon, end }) => (
              <NavLink key={label} to={path ? `${base}/${path}` : base} end={end} className={itemClass} onClick={onNavigate}>
                <Icon className="size-5 lg:size-[18px]" /> {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {accountId && (
          <NavLink to={`${base}/settings`} className={itemClass} onClick={onNavigate}>
            <SlidersHorizontalIcon className="size-5 lg:size-[18px]" /> このアカウントの設定
          </NavLink>
        )}
        <UserMenu />
      </div>
    </div>
  );
}

// サイドバーのAccount一覧と切り替え（FR-007・FR-019、規則5）。
// 選んだら /accounts/:id へ遷移するだけ。記録は遷移先の画面の open で行う。
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, PlusIcon } from "lucide-react";
import { NavLink } from "react-router";
import { AccountAvatar } from "@/components/AccountAvatar";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";

/**
 * サイドバーの Account 一覧と切り替え（FR-007・FR-019、規則5）。選んだら遷移するだけで、記録は遷移先の open で行う。
 * @returns Account の一覧
 */
export function AccountSwitcher() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const accounts = me.data?.accounts ?? [];
  return (
    <ul className="space-y-1">
      {accounts.map((a) => (
        <li key={a.id}>
          <NavLink
            to={`/accounts/${a.id}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                isActive && "bg-accent font-medium",
              )
            }
          >
            <AccountAvatar account={a} className="size-6" />
            <span className="min-w-0 flex-1 truncate">@{a.username}</span>
            {a.connectionStatus === "needs_reconnect" && (
              <AlertTriangleIcon className="size-4 text-warning" aria-label="要再接続" />
            )}
          </NavLink>
        </li>
      ))}
      <li>
        <NavLink
          to="/accounts/new"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        >
          <PlusIcon className="size-4" /> 追加
        </NavLink>
      </li>
    </ul>
  );
}

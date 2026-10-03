// サイドバー左上のAccountの切り替え（docs/ui-design.md「2. 画面の骨格」、001 FR-007・FR-019）。
// 表示中のAccountのボタンからドロップダウンを開く。選んだら /accounts/:id へ遷移するだけで、記録は遷移先の open で行う。
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { Link, useParams } from "react-router";
import { AccountAvatar } from "@/components/AccountAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * Account の切り替え。表示中の Account のボタンから、全 Account の一覧と「アカウントを追加」を開く。
 * @param props - onNavigate：項目を選んだときの処理（ドロワーを閉じるなど）
 * @returns Account の切り替え
 */
export function AccountSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { accountId } = useParams<{ accountId: string }>();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const accounts = me.data?.accounts ?? [];
  const current = accounts.find((a) => a.id === accountId) ?? accounts[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Accountを切り替える"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent data-[state=open]:bg-accent"
      >
        {current ? (
          <>
            <AccountAvatar account={current} className="size-8" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-semibold">{current.displayName ?? current.username}</span>
              <span className="truncate text-xs text-muted-foreground">@{current.username}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-muted-foreground">Account</span>
        )}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 rounded-xl p-1.5">
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} asChild className="gap-2.5 rounded-lg py-2">
            <Link to={`/accounts/${a.id}`} onClick={onNavigate}>
              <AccountAvatar account={a} className="size-7" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate font-medium">{a.displayName ?? a.username}</span>
                {a.connectionStatus === "needs_reconnect" ? (
                  <span className="text-xs text-warning">@{a.username}・要再接続</span>
                ) : (
                  <span className="truncate text-xs text-muted-foreground">@{a.username}</span>
                )}
              </span>
              {a.connectionStatus === "needs_reconnect" && (
                <TriangleAlertIcon className="size-4 text-warning" aria-hidden="true" />
              )}
              {a.id === current?.id && <CheckIcon className="size-4" aria-label="表示中" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="rounded-lg py-2">
          <Link to="/accounts/new" onClick={onNavigate}>
            <PlusIcon className="size-4" /> アカウントを追加
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

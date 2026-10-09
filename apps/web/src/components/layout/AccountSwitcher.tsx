// サイドバー左上のAccount切り替え。開くたびに所有Accountと要確認件数を読み直す。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountSummary, MeResponse } from "@threads-grower/shared";
import { CheckIcon, ChevronDownIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

type MenuState = {
  phase: "loading-accounts" | "accounts-error" | "loading-counts" | "ready" | "counts-error";
  accounts: AccountSummary[];
  counts: Record<string, number>;
};

const emptyMenu: MenuState = { phase: "loading-accounts", accounts: [], counts: {} };

/**
 * Accountの切り替え。件数取得が失敗しても、最新のAccount一覧で切り替えられる。
 * @param props - onNavigate：項目を選んだときの処理（ドロワーを閉じるなど）
 * @returns Accountの切り替えメニュー
 */
export function AccountSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { accountId } = useParams<{ accountId: string }>();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const current = me.data?.accounts.find((a) => a.id === accountId) ?? me.data?.accounts[0];
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState>(emptyMenu);
  const requestVersion = useRef(0);

  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [],
  );

  /**
   * Account一覧を取り直し、キャッシュも新しい一覧にそろえる。
   * 取り消すのは取り直しより前に始まった /api/me の取得だけ。後から始まった取得があれば、
   * そちらの方が新しいので、キャッシュはそれに任せて上書きしない。
   * @param version - この読み込みの番号
   * @returns 取り直したAccount一覧。新しい読み込みに追い越されたら null
   */
  async function refreshMe(version: number) {
    await queryClient.cancelQueries({ queryKey: queryKeys.me, exact: true });
    const updatesBefore = queryClient.getQueryState(queryKeys.me)?.dataUpdateCount ?? 0;
    let fresh: MeResponse;
    try {
      fresh = await api.me();
    } catch (error) {
      // 取り消した取得をやり直し、キャッシュを古い一覧のままにしない。
      void queryClient.invalidateQueries({ queryKey: queryKeys.me, exact: true });
      throw error;
    }
    const state = queryClient.getQueryState(queryKeys.me);
    const newerStarted =
      state?.fetchStatus === "fetching" || (state?.dataUpdateCount ?? 0) > updatesBefore;
    if (!newerStarted) queryClient.setQueryData(queryKeys.me, fresh);
    return version === requestVersion.current ? fresh : null;
  }

  async function loadCounts(accounts: AccountSummary[], version: number) {
    setMenu({ phase: "loading-counts", accounts, counts: {} });
    let response: Awaited<ReturnType<typeof api.needsReviewCounts>>;
    try {
      // APIを毎回呼び、キャッシュ済みの数字を今回の結果として表示しない。
      response = await api.needsReviewCounts();
    } catch {
      if (version === requestVersion.current)
        setMenu({ phase: "counts-error", accounts, counts: {} });
      return;
    }
    if (version !== requestVersion.current) return;
    queryClient.setQueryData(queryKeys.needsReviewCounts, response);
    const counts = Object.fromEntries(
      response.counts.map((row) => [row.accountId, row.needsReview]),
    );
    let latestAccounts = accounts;
    if (accounts.some((account) => counts[account.id] === undefined)) {
      // 一覧と件数の間にAccountが削除された可能性がある。
      setMenu(emptyMenu);
      try {
        const refreshed = await refreshMe(version);
        if (!refreshed) return;
        latestAccounts = refreshed.accounts;
      } catch {
        if (version === requestVersion.current)
          setMenu({ phase: "accounts-error", accounts: [], counts: {} });
        return;
      }
    }
    if (version === requestVersion.current)
      setMenu({ phase: "ready", accounts: latestAccounts, counts });
  }

  async function loadAccounts(version: number) {
    setMenu(emptyMenu);
    try {
      const fresh = await refreshMe(version);
      if (!fresh) return;
      await loadCounts(fresh.accounts, version);
    } catch {
      if (version === requestVersion.current)
        setMenu({ phase: "accounts-error", accounts: [], counts: {} });
    }
  }

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    const version = ++requestVersion.current;
    if (nextOpen) void loadAccounts(version);
  }

  function retryAccounts() {
    void loadAccounts(++requestVersion.current);
  }

  function retryCounts() {
    void loadCounts(menu.accounts, ++requestVersion.current);
  }

  const missingCount =
    menu.phase === "ready" && menu.accounts.some((a) => menu.counts[a.id] === undefined);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label="Accountを切り替える"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent data-[state=open]:bg-accent"
      >
        {current ? (
          <>
            <AccountAvatar account={current} className="size-8" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-semibold">
                {current.displayName ?? current.username}
              </span>
              <span className="truncate text-xs text-muted-foreground">@{current.username}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-muted-foreground">Account</span>
        )}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(18rem,calc(100vw-1rem))] max-h-[calc(100dvh-1rem-env(safe-area-inset-bottom))] overflow-y-auto rounded-xl p-1.5"
      >
        {menu.phase === "loading-accounts" && (
          <p className="px-2 py-3 text-sm text-muted-foreground">アカウントを確認中</p>
        )}
        {menu.phase === "accounts-error" && (
          <>
            <p className="px-2 py-3 text-sm text-muted-foreground">アカウントを読み込めません</p>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                retryAccounts();
              }}
            >
              再試行
            </DropdownMenuItem>
          </>
        )}
        {menu.phase !== "loading-accounts" && menu.phase !== "accounts-error" && (
          <>
            {menu.accounts.map((account) => (
              <DropdownMenuItem
                key={account.id}
                asChild
                className="min-h-11 gap-2.5 rounded-lg py-2"
              >
                <Link to={`/accounts/${account.id}`} onClick={onNavigate}>
                  <AccountAvatar account={account} className="size-7" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium">
                      {account.displayName ?? account.username}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      @{account.username}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {menu.phase === "loading-counts"
                        ? "取得中"
                        : menu.phase === "counts-error" || menu.counts[account.id] === undefined
                          ? "取得できません"
                          : `要確認 ${menu.counts[account.id]}件`}
                    </span>
                    {account.connectionStatus === "needs_reconnect" && (
                      <span className="text-xs text-warning">要再接続</span>
                    )}
                    {account.id === accountId && (
                      <span className="text-xs text-muted-foreground">表示中</span>
                    )}
                  </span>
                  {account.connectionStatus === "needs_reconnect" && (
                    <TriangleAlertIcon
                      className="size-4 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                  )}
                  {account.id === accountId && (
                    <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
                  )}
                </Link>
              </DropdownMenuItem>
            ))}
            {(menu.phase === "counts-error" || missingCount) && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  retryCounts();
                }}
              >
                件数を再試行
              </DropdownMenuItem>
            )}
            {menu.accounts.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">アカウントがありません</p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="min-h-11 rounded-lg py-2">
              <Link to="/accounts/new" onClick={onNavigate}>
                <PlusIcon className="size-4" aria-hidden="true" /> アカウントを追加
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

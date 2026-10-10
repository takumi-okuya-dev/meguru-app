// サイドバー左上のAccount切り替え。開くたびに所有Accountと要確認件数を読み直す。
import { isCancelledError, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountSummary } from "@threads-grower/shared";
import { CheckIcon, ChevronDownIcon, LayoutGridIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
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
   * Account一覧を取り直す。/api/me のクエリを通して取り、キャッシュと表示を同じ結果にそろえる。
   * 開く前に始まった取得だけを取り消し、後から始まった取得に置き換えられたらその結果を待つ。
   * @param version - この読み込みの番号
   * @returns 取り直したAccount一覧。新しい読み込みに追い越されたら null
   */
  async function refreshMe(version: number) {
    await queryClient.cancelQueries({ queryKey: queryKeys.me, exact: true });
    for (let attempt = 0; ; attempt += 1) {
      try {
        const fresh = await queryClient.fetchQuery({ queryKey: queryKeys.me, queryFn: api.me });
        return version === requestVersion.current ? fresh : null;
      } catch (error) {
        // 後から始まった取得に置き換えられたときだけ、その取得を待ち直す。
        if (!isCancelledError(error) || attempt >= 3) throw error;
      }
    }
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
            {menu.accounts.map((account, i) => (
              <Fragment key={account.id}>
              {groupHeading(menu.accounts, i) && (
                // 手伝っているAccountがあるときだけ、見出しで2つに分ける（specs/008 FR-043）
                <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{groupHeading(menu.accounts, i)}</p>
              )}
              <DropdownMenuItem
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
                      {account.ownerName ? ` · オーナー ${account.ownerName}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {menu.phase === "loading-counts"
                        ? "取得中"
                        : menu.phase === "counts-error" || menu.counts[account.id] === undefined
                          ? "取得できません"
                          : `要確認 ${menu.counts[account.id]}件`}
                    </span>
                    {account.connectionStatus === "needs_reconnect" && (
                      <span className="text-xs text-warning">
                        {account.role === "owner" ? "要再接続" : "オーナーの再接続待ち"}
                      </span>
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
              </Fragment>
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
            {me.data?.partnerTeam && (
              // パートナーの画面への入口（specs/008 FR-043・FR-060）。担当未定の編集者がいれば人数を出す（FR-047(2)）
              <DropdownMenuItem asChild className="min-h-11 rounded-lg py-2">
                <Link to="/partner/accounts" onClick={onNavigate}>
                  <LayoutGridIcon className="size-4" aria-hidden="true" />
                  <span className="flex-1">手伝っているアカウントをまとめて見る</span>
                  {me.data.partnerTeam.unassignedEditorCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      担当未定 {me.data.partnerTeam.unassignedEditorCount}人
                    </span>
                  )}
                </Link>
              </DropdownMenuItem>
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

/**
 * 切り替えメニューの見出し（specs/008 FR-043）。手伝っているAccountがあるときだけ、各まとまりの最初の行の上に出す。
 * 自分のAccountがなければ「自分のアカウント」は出さない。
 * @param accounts - メニューのAccount（自分のAccount → 手伝っているAccountの順）
 * @param i - 行の番号
 * @returns 見出し。出さないならNULL
 */
export function groupHeading(accounts: AccountSummary[], i: number): string | null {
  if (!accounts.some((a) => a.role !== "owner")) return null;
  const isHelper = accounts[i]!.role !== "owner";
  const prevHelper = i > 0 ? accounts[i - 1]!.role !== "owner" : null;
  if (i === 0) return isHelper ? "手伝っているアカウント" : "自分のアカウント";
  return isHelper && prevHelper === false ? "手伝っているアカウント" : null;
}

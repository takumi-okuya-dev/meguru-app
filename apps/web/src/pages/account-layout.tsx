// Accountの画面（/accounts/:accountId とその配下）の共通の親
// - Accountが0件なら /accounts/new へ（規則3）
// - 他人・存在しないAccountは404画面（規則4）
// - 画面を開いたら open を呼び、接続状態とプロフィールを最新にする（規則5）
// - needs_reconnect ならバナーを出す（FR-019）
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NEEDS_RECONNECT_BANNER, errorMessage, type AccountSummary } from "@threads-grower/shared";
import { Link, Navigate, Outlet, useOutletContext, useParams } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useAccountOpen } from "@/lib/use-account-open";
import { NotFound } from "@/pages/not-found";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";

/** Account の画面の子に渡す値。 */
export type AccountOutletContext = { account: AccountSummary };

/**
 * Account の画面の子から、表示中の Account を受け取る。
 * @returns 表示中の Account
 */
export function useCurrentAccount() {
  return useOutletContext<AccountOutletContext>().account;
}

/**
 * Account の画面（/accounts/:accountId とその配下）の共通の親（規則3・4・5、FR-019）。
 * Accountが0件ならアカウント追加画面へ、他人・存在しない Account なら404、needs_reconnect ならバナーを出す。
 * @returns Account の画面の骨格
 */
export function AccountLayout() {
  const { accountId } = useParams<{ accountId: string }>();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const account = useQuery({
    queryKey: queryKeys.account(accountId ?? ""),
    queryFn: () => api.account(accountId!),
    enabled: Boolean(accountId) && (me.data?.accounts.length ?? 0) > 0,
  });

  useAccountOpen(accountId, (latest) => {
    queryClient.setQueryData(queryKeys.account(latest.id), latest);
    // 一覧の接続状態・並び順も最新にする
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  });

  if (me.isPending) return <LoadingSkeleton />;
  if (me.isError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  if (me.data.accounts.length === 0) return <Navigate to="/accounts/new" replace />;
  if (account.isError) {
    if (account.error instanceof ApiError && account.error.code === "ACCOUNT_NOT_FOUND") {
      return <NotFound message={errorMessage("ACCOUNT_NOT_FOUND").message} />;
    }
    return <ApiErrorScreen error={account.error} onRetry={() => void account.refetch()} />;
  }
  if (!account.data) return <LoadingSkeleton />;

  return (
    <AppShell>
      {account.data.connectionStatus === "needs_reconnect" && (
        <Alert variant="warning" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <AlertDescription className="text-foreground">{NEEDS_RECONNECT_BANNER}</AlertDescription>
          <Button asChild size="sm">
            <Link to={`/accounts/${account.data.id}/settings`}>再接続</Link>
          </Button>
        </Alert>
      )}
      <Outlet context={{ account: account.data } satisfies AccountOutletContext} />
    </AppShell>
  );
}

// Accountの画面（/accounts/:accountId とその配下）の共通の親
// - Accountが0件なら /accounts/new へ（規則3）
// - 他人・存在しないAccountは404画面（規則4）
// - 画面を開いたら open を呼び、接続状態とプロフィールを最新にする（規則5）
// - needs_reconnect ならバナーを出す（FR-019）
// - 担当しているAccountも開ける（specs/011。/api/me の accounts はオーナーと担当）
// - 見せてもらっているAccountは、読むだけの画面（/teams/:teamId/accounts/:accountId）へ移す（specs/011 contracts/permissions.md）
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NEEDS_RECONNECT_BANNER,
  NEEDS_RECONNECT_BANNER_HELPER,
  NEEDS_RECONNECT_BANNER_TOKEN,
  errorMessage,
  type AccountSummary,
} from "@meguru/shared";
import { Link, Navigate, Outlet, useOutletContext, useParams } from "react-router";
import { ReadOnlyBanner } from "@/components/billing/ReadOnlyBanner";
import { TrialEndingBanner } from "@/components/billing/TrialEndingBanner";
import { AppShell } from "@/components/layout/AppShell";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useAccountOpen } from "@/lib/use-account-open";
import { useAccountAccess, useAccountAccessErrors } from "@/lib/use-account-access";
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
 * 要再接続のバナーの文言（001 FR-019、specs/008 FR-044、specs/010 FR-041）。
 * オーナーには再接続を、トークンで接続していれば新しいトークンの貼り付けを案内し、担当の人にはオーナーを待つ案内を出す。
 * @param account - 要再接続のAccount
 * @returns バナーの文言
 */
export function reconnectBannerText(account: Pick<AccountSummary, "role" | "connectionMethod">): string {
  if (account.role !== "owner") return NEEDS_RECONNECT_BANNER_HELPER;
  return account.connectionMethod === "token" ? NEEDS_RECONNECT_BANNER_TOKEN : NEEDS_RECONNECT_BANNER;
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

  // 権限がなくなった・開けなくなったときの扱い（specs/008 contracts/ui-routes.md「共通の振る舞い」2・3）
  useAccountAccessErrors(accountId);

  // 開く記録（open）は、切り替えメニューに出るAccount（オーナー・担当）だけ。/api/me を読む前は今までどおりすぐ始め、
  // 読んだ後に一覧にない（見せてもらっている）と分かったら止める
  const unlisted = Boolean(me.data && !me.data.accounts.some((a) => a.id === accountId));
  // 関わりと権限。見せてもらっているAccountの移動と、読むだけの帯（specs/013 FR-045）に使う
  const { access } = useAccountAccess(account.data ? accountId : undefined);
  useAccountOpen(unlisted ? undefined : accountId, (latest) => {
    queryClient.setQueryData(queryKeys.account(latest.id), latest);
    // 一覧の接続状態・並び順も最新にする
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  });

  if (me.isPending) return <LoadingSkeleton />;
  // 一度読めていれば、裏での取り直しの失敗では画面を差し替えず、手元の一覧で表示を続ける。
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  if (me.data.accounts.length === 0) return <Navigate to="/accounts/new" replace />;
  if (account.isError) {
    if (account.error instanceof ApiError && account.error.code === "ACCOUNT_NOT_FOUND") {
      return <NotFound message={errorMessage("ACCOUNT_NOT_FOUND").message} />;
    }
    return <ApiErrorScreen error={account.error} onRetry={() => void account.refetch()} />;
  }
  if (!account.data) return <LoadingSkeleton />;
  if (account.data.role === "viewer") {
    if (!access) return <LoadingSkeleton />;
    if (access.team) return <Navigate to={`/teams/${access.team.id}/accounts/${account.data.id}`} replace />;
  }

  // 再接続のバナーは、各画面の上部バーの下に出す（docs/ui-design.md「2. 画面の骨格」）
  const reconnectBanner =
    account.data.connectionStatus === "needs_reconnect" ? (
      <Alert
        variant="warning"
        className="flex flex-col gap-3 rounded-none border-x-0 border-t-0 px-4 sm:flex-row sm:items-center sm:justify-between md:px-5"
      >
        {account.data.role === "owner" ? (
          <>
            <AlertDescription className="text-foreground">{reconnectBannerText(account.data)}</AlertDescription>
            <Button asChild size="sm">
              <Link to={`/accounts/${account.data.id}/settings`}>再接続</Link>
            </Button>
          </>
        ) : (
          // 再接続はオーナーだけができる（specs/008 FR-044）
          <AlertDescription className="text-foreground">{reconnectBannerText(account.data)}</AlertDescription>
        )}
      </Alert>
    ) : null;
  // 帯の並び：無料体験の終わり → 読むだけ → 要再接続（specs/013 contracts/ui-routes.md「帯」）
  const banner = (
    <>
      <TrialEndingBanner billing={me.data.billing} />
      {access?.readOnly && <ReadOnlyBanner reason={access.readOnly.reason} />}
      {reconnectBanner}
    </>
  );

  return (
    <AppShell banner={banner}>
      <UnsavedChangesProvider>
        <Outlet context={{ account: account.data } satisfies AccountOutletContext} />
      </UnsavedChangesProvider>
    </AppShell>
  );
}

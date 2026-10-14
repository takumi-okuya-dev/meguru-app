// アカウント追加画面（FR-008・FR-017、規則8、「常時表示する案内」。specs/010 でトークンでの追加を足した）
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  RECONNECT_FROM_SETTINGS_HINT,
  TESTER_NOTICE,
  errorMessage,
} from "@threads-grower/shared";
import { AppShell, CenteredLayout } from "@/components/layout/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api, describeError } from "@/lib/api-client";
import { useCallbackResult } from "@/lib/callback-result";
import { queryKeys } from "@/lib/query";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";
import { TokenConnectForm, warnParam } from "@/components/connect/TokenConnectForm";
import { isInvitePath, rememberInviteReturn, takeInviteReturn } from "@/lib/invite-return";
import { cn } from "@/lib/utils";

/**
 * アカウント追加画面（FR-008・FR-017、規則8）。上限の案内とテスター制限の案内を出す。
 * @returns アカウント追加画面
 */
export function AccountNew() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const navigate = useNavigate();
  const [tokenOpen, setTokenOpen] = useState(false);
  useCallbackResult({ max: me.data?.accountLimit.max });
  // 招待リンクから来たときは、追加の後にリンクへ戻す（specs/011 T019）
  const next = useSearchParams()[0].get("next");
  useEffect(() => {
    if (isInvitePath(next)) rememberInviteReturn(next);
  }, [next]);
  const connect = useMutation({
    mutationFn: () => api.connect({ mode: "new" }),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });

  if (me.isPending) return <LoadingSkeleton />;
  // 一度読めていれば、裏での取り直しの失敗では画面を差し替えず、手元の一覧で表示を続ける。
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;

  const { max, used } = me.data.accountLimit;
  const limitReached =
    used >= max || (connect.error instanceof ApiError && connect.error.code === "ACCOUNT_LIMIT_REACHED");

  const content = (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Threadsアカウントを追加</h1>
        <p className="text-sm text-muted-foreground">
          登録済み {used} / {max} 件
        </p>
      </div>

      {limitReached ? (
        <Alert variant="warning">
          <AlertDescription className="space-y-2 text-foreground">
            <p>{errorMessage("ACCOUNT_LIMIT_REACHED", { max }).message}</p>
            <p className="text-muted-foreground">{RECONNECT_FROM_SETTINGS_HINT}</p>
          </AlertDescription>
        </Alert>
      ) : (
        connect.isError && (
          <Alert variant="destructive">
            <AlertDescription className="text-foreground">{describeError(connect.error, { max })}</AlertDescription>
          </Alert>
        )
      )}

      <Button className="w-full" disabled={limitReached || connect.isPending} onClick={() => connect.mutate()}>
        Threadsアカウントを接続
      </Button>

      {/* Meta App Review の前（テスターだけが接続できる間）だけ出す（specs/002 FR-028） */}
      {me.data.threadsAccessMode === "testers" && (
        <Alert>
          <AlertDescription>{TESTER_NOTICE}</AlertDescription>
        </Alert>
      )}

      {/* 2つ目の方法（specs/010 FR-001）。開くまで手順と入力欄を出さない。検証期間かどうかにかかわらず出す */}
      <div className="space-y-4 border-t pt-4">
        <button
          type="button"
          aria-expanded={tokenOpen}
          onClick={() => setTokenOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-medium"
        >
          自分のMetaアプリのトークンで追加する
          <ChevronDownIcon aria-hidden="true" className={cn("size-4 transition-transform", tokenOpen && "rotate-180")} />
        </button>
        {tokenOpen &&
          (limitReached ? (
            <p className="text-sm text-muted-foreground">{errorMessage("ACCOUNT_LIMIT_REACHED", { max }).message}</p>
          ) : (
            <TokenConnectForm
              mode="new"
              onSuccess={(result) => {
                const warn = warnParam(result.warnings);
                const back = takeInviteReturn();
                void navigate(back ?? `/accounts/${result.accountId}?connected=new${warn ? `&warn=${warn}` : ""}`);
              }}
            />
          ))}
      </div>
    </div>
  );

  // Accountが0件のときはサイドバーなしの1カラム（contracts/ui-routes.md）
  return used === 0 ? <CenteredLayout>{content}</CenteredLayout> : <AppShell>{content}</AppShell>;
}

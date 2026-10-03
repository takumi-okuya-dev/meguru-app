// アカウント追加画面（FR-008・FR-017、規則8、「常時表示する案内」）
import { useMutation, useQuery } from "@tanstack/react-query";
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

/**
 * アカウント追加画面（FR-008・FR-017、規則8）。上限の案内とテスター制限の案内を出す。
 * @returns アカウント追加画面
 */
export function AccountNew() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  useCallbackResult({ max: me.data?.accountLimit.max });
  const connect = useMutation({
    mutationFn: () => api.connect({ mode: "new" }),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });

  if (me.isPending) return <LoadingSkeleton />;
  if (me.isError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;

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
    </div>
  );

  // Accountが0件のときはサイドバーなしの1カラム（contracts/ui-routes.md）
  return used === 0 ? <CenteredLayout>{content}</CenteredLayout> : <AppShell>{content}</AppShell>;
}

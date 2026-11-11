// アカウントを作る画面（specs/012 FR-001〜FR-006、contracts/ui-routes.md「アカウントを作る」）。
// 名前だけで作り、Threadsには後で「このアカウントの設定」の「Threadsとの接続」からつなぐ。
// 上限・読むだけ・2件目からの料金の案内は specs/013 contracts/ui-routes.md「アカウントを作る」。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACCOUNT_NAME_MAX,
  BILLING_UNIT_PRICE_JPY,
  RECONNECT_FROM_SETTINGS_HINT,
  countChars,
  errorMessage,
} from "@meguru/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { readOnlyMessage } from "@/components/billing/BillingRequiredDialog";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { CenteredLayout } from "@/shell";
import { ThreadsShell } from "../sidebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api, describeError } from "@/lib/api-client";
import { isInvitePath, rememberInviteReturn } from "@/lib/invite-return";
import { queryKeys } from "@/lib/query";

/**
 * アカウントを作る画面。名前の入力欄1つと「作る」。上限に達していれば、入力欄の代わりに上限の案内を出す。
 * @returns アカウントを作る画面
 */
export function AccountNew() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  // 招待リンクから来たときは、つないだ後にリンクへ戻す（specs/011 T019、specs/012 research.md R7）
  const next = useSearchParams()[0].get("next");
  useEffect(() => {
    if (isInvitePath(next)) rememberInviteReturn(next);
  }, [next]);
  const create = useMutation({
    mutationFn: () => api.createAccount({ name: name.trim() }),
    onSuccess: async (account) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void navigate(`/accounts/${account.id}`);
    },
  });

  if (me.isPending) return <LoadingSkeleton />;
  // 一度読めていれば、裏での取り直しの失敗では画面を差し替えず、手元の一覧で表示を続ける。
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;

  const { max, used } = me.data.accountLimit;
  const billing = me.data.billing;
  const createCode = create.error instanceof ApiError ? create.error.code : null;
  // 読むだけ（無料体験の終わり・支払いの失敗・解約の後）なら作れない（specs/013 FR-043）
  const readOnlyReason =
    billing.state === "read_only"
      ? (billing.readOnlyReason ?? "trial_ended")
      : createCode === "BILLING_REQUIRED"
        ? ((create.error as ApiError).details[0] ?? "trial_ended")
        : null;
  // 上限は運営者が決める値と、前からの無料体験の1件（null は上限なし。specs/024 FR-018）
  const limitReached = (max !== null && used >= max) || createCode === "ACCOUNT_LIMIT_REACHED";
  const inTrial = billing.state === "trial";
  const subscribed = billing.state === "subscribed_trial" || billing.state === "active" || billing.state === "canceling";
  const trimmed = name.trim();
  const canSubmit = trimmed !== "" && countChars(trimmed) <= ACCOUNT_NAME_MAX && !create.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canSubmit) create.mutate();
  }

  const content = (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">アカウントを作る</h1>
        <p className="text-sm text-muted-foreground">運用するThreadsアカウントごとに1つ作ります。</p>
        {/* はじめての人には数を見せない（contracts/ui-routes.md） */}
        {used > 0 && (
          <p className="text-sm text-muted-foreground">
            登録済み {used}
            {max !== null ? `/${max}` : ""}件
          </p>
        )}
      </div>

      {readOnlyReason ? (
        <Alert variant="warning">
          <AlertDescription className="space-y-3 text-foreground">
            <p>{readOnlyMessage(readOnlyReason)}</p>
            <Button asChild size="sm" className="rounded-full">
              <Link to="/settings/billing">{readOnlyReason === "payment_failed" ? "支払いの画面を開く" : "契約する"}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : limitReached ? (
        <Alert variant="warning">
          <AlertDescription className="space-y-3 text-foreground">
            <p>{errorMessage("ACCOUNT_LIMIT_REACHED", { max: max ?? 1, details: inTrial ? ["trial"] : [] }).message}</p>
            {/* 前からの無料体験の上限なら契約で増やせる。運営者が決めた上限なら、運営者に連絡する（specs/024 FR-018） */}
            {inTrial && (
              <Button asChild size="sm" className="rounded-full">
                <Link to="/settings/billing">契約する</Link>
              </Button>
            )}
            <p className="text-muted-foreground">{RECONNECT_FROM_SETTINGS_HINT}</p>
          </AlertDescription>
        </Alert>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <FieldWithCounter
            id="account-name"
            label="アカウントの名前"
            placeholder="例：カフェの公式"
            value={name}
            onChange={setName}
            max={ACCOUNT_NAME_MAX}
            multiline={false}
          />
          {create.isError && (
            <Alert variant="destructive">
              <AlertDescription className="text-foreground">{describeError(create.error, { max: max ?? undefined })}</AlertDescription>
            </Alert>
          )}
          {/* 契約中の2件目からは料金がかかる（specs/013 FR-031） */}
          {subscribed && used >= 1 && (
            <p className="text-sm text-muted-foreground">
              アカウント1件につき月{BILLING_UNIT_PRICE_JPY.toLocaleString("ja-JP")}円です。次の請求から反映されます。
            </p>
          )}
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            作る
          </Button>
          <p className="text-sm text-muted-foreground">Threadsには、あとで「このアカウントの設定」からつなげます。</p>
        </form>
      )}
    </div>
  );

  // Accountが0件のときはサイドバーなしの1カラム（contracts/ui-routes.md）
  return used === 0 ? <CenteredLayout>{content}</CenteredLayout> : <ThreadsShell>{content}</ThreadsShell>;
}

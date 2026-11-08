// 契約前の画面（specs/024-tester-invite-connect contracts/ui-routes.md 1、FR-029、モック1枚目）。
// 無料体験はなく、契約するまではアプリを使えない。料金と「契約する」だけを出し、ログアウト・退会は下に離して置く。
import { useMutation, useQuery } from "@tanstack/react-query";
import { BILLING_UNIT_PRICE_JPY } from "@threads-grower/shared";
import { useEffect } from "react";
import { Link } from "react-router";
import { CenteredLayout } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { api, describeError, setSubscriptionRequired } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useLogout } from "@/lib/use-logout";

/** 料金の下の箇条書き。 */
const NOTES = ["契約すると、すぐにアカウントを作れます", "いつでも解約できます"] as const;

/**
 * 契約前の画面。
 * @returns 画面
 */
export function SubscribeRequired() {
  const logout = useLogout();
  // 開いたときに読み直す。別のタブで契約した・料金なしになった場合は、me の応答で元の画面に戻る
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const subscribed = me.data ? me.data.billing.state !== "unsubscribed" : false;
  useEffect(() => {
    if (subscribed) setSubscriptionRequired(false);
  }, [subscribed]);
  const checkout = useMutation({
    mutationFn: api.startCheckout,
    onSuccess: ({ url }) => window.location.assign(url),
  });
  return (
    <CenteredLayout>
      <div className="flex w-full max-w-md flex-col gap-5">
        <h1 className="text-xl font-semibold">契約してから使い始めます</h1>
        <div className="flex items-baseline justify-between gap-3 rounded-2xl border bg-card px-4 py-4">
          <span className="text-sm text-muted-foreground">アカウント1件につき</span>
          <span className="text-lg font-semibold">月{BILLING_UNIT_PRICE_JPY.toLocaleString("ja-JP")}円</span>
        </div>
        <Button className="w-full rounded-full" disabled={checkout.isPending} onClick={() => checkout.mutate()}>
          {checkout.isPending ? "支払いの画面に移っています…" : "契約する"}
        </Button>
        {checkout.isError && (
          <p role="alert" className="text-sm text-destructive">
            {describeError(checkout.error)}
          </p>
        )}
        <ul className="space-y-0.5 text-[13px] text-muted-foreground">
          {NOTES.map((n) => (
            <li key={n}>・{n}</li>
          ))}
        </ul>
        {/* 押し間違えないよう、ログアウト・退会は下に離す（docs/ui-design.md） */}
        <div className="mt-8 flex justify-center gap-6 text-[13px]">
          <button type="button" className="underline underline-offset-4" onClick={() => void logout()}>
            ログアウト
          </button>
          <Link to="/settings/account" className="underline underline-offset-4">
            退会する
          </Link>
        </div>
      </div>
    </CenteredLayout>
  );
}

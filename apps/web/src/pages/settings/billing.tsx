// 設定 > 契約と支払い（specs/013-billing contracts/ui-routes.md「契約と支払い」、FR-020〜FR-025・FR-033・FR-034）。
// カードの入力・契約の確認・カードの変更・解約は、Stripeの画面（Checkout・カスタマーポータル）で行う。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, type BillingSummary } from "@threads-grower/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";
import { SettingCard, SettingRow } from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query";

/** Checkoutから戻ったときに、契約が反映されるのを待つ時間（SC-002：10秒以内）。 */
const CHECKOUT_WAIT_MS = 10_000;
const CHECKOUT_POLL_MS = 1_000;

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/**
 * 状態の行の見出しと説明を作る。
 * @param s - 契約と支払いの内容
 * @returns 見出しと説明
 */
function describe(s: BillingSummary): { title: string; body: string | null } {
  const sub = s.subscription;
  switch (s.state) {
    case "billing_disabled":
      return { title: "この環境では決済を使いません", body: null };
    case "exempt":
      return { title: "料金なし", body: "料金はかかりません" };
    case "trial":
      return {
        title: `無料体験中：${formatDate(s.trialEndsAt!)}まで（あと${s.trialDaysLeft ?? 0}日）`,
        body: `アカウント${s.ownedAccountCount ?? 0}件。契約しても、無料体験が終わるまで料金はかかりません`,
      };
    case "subscribed_trial":
      return {
        title: "無料体験中（契約済み）",
        body: sub?.nextInvoiceAt
          ? `最初の請求日 ${formatDate(sub.nextInvoiceAt)}・見込み ${yen(sub.nextInvoiceAmount ?? 0)}・アカウント${s.ownedAccountCount ?? 0}件`
          : null,
      };
    case "active":
      return {
        title: "契約中",
        body: sub?.nextInvoiceAt
          ? `次の請求日 ${formatDate(sub.nextInvoiceAt)}・見込み ${yen(sub.nextInvoiceAmount ?? 0)}・アカウント${s.ownedAccountCount ?? 0}件`
          : null,
      };
    case "canceling":
      return {
        title: sub?.currentPeriodEnd ? `${formatDate(sub.currentPeriodEnd)}に終わります（解約済み）` : "解約済み",
        body: "その日まで、すべての機能を使えます。解約は支払いの画面から取り消せます",
      };
    case "read_only":
      if (s.readOnlyReason === "payment_failed") {
        return { title: "支払いに失敗しました", body: "カードを更新すると、すぐに元どおり使えます" };
      }
      return {
        title: s.readOnlyReason === "canceled" ? "契約が終わりました" : "無料体験が終わりました",
        body: "今は読むだけです。契約すると、すぐに元どおり使えます",
      };
  }
}

/**
 * どのボタンを出すか。契約のない人は「契約する」、契約のある人は「支払いの画面を開く」。
 * @param s - 契約と支払いの内容
 * @returns ボタン
 */
function actionOf(s: BillingSummary): "checkout" | "portal" | null {
  if (s.state === "billing_disabled" || s.state === "exempt") return null;
  if (s.state === "trial") return "checkout";
  if (s.state === "read_only") return s.readOnlyReason === "payment_failed" ? "portal" : "checkout";
  return "portal";
}

/**
 * 設定 > 契約と支払い。
 * @returns 契約と支払いの画面
 */
export function BillingSettingsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const checkout = params.get("checkout");
  const summary = useQuery({ queryKey: queryKeys.billing, queryFn: api.billing });
  const [waiting, setWaiting] = useState(checkout === "success");
  const [slow, setSlow] = useState(false);
  const syncedOnce = useRef(false);
  // 開いたときの読み直しが終わるまで「契約する」を押せなくする（未同期の完了済みのCheckoutで2つ目を作らない。
  // PR #16 のCodexレビュー）
  const [initialSyncDone, setInitialSyncDone] = useState(false);

  const apply = (s: BillingSummary) => {
    queryClient.setQueryData(queryKeys.billing, s);
    // 帯・アカウントを作る画面の状態も最新にする
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  // Checkoutから戻ったら、知らせを待たずに読み直す（FR-023）。最大10秒くり返す
  useEffect(() => {
    if (checkout !== "success") {
      if (checkout === "canceled") setParams({}, { replace: true });
      return;
    }
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const s = await api.syncBilling();
        apply(s);
        if (s.state === "subscribed_trial" || s.state === "active") {
          setWaiting(false);
          toast.success("契約しました");
          setParams({}, { replace: true });
          return;
        }
      } catch {
        // 一時的な失敗は、時間の中でもう一度
      }
      if (Date.now() - started >= CHECKOUT_WAIT_MS) {
        setWaiting(false);
        setSlow(true);
        setParams({}, { replace: true });
        return;
      }
      setTimeout(() => void tick(), CHECKOUT_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
    };
    // checkout の値が変わったときだけ動かす
  }, [checkout]);

  // 決済ONなら、画面を開くたびに1回読み直す（知らせが届かず、Checkoutから戻る前に閉じた場合も拾う。FR-036、
  // PR #16 のCodexレビュー）。顧客がなければ、APIはStripeを呼ばずに返す
  useEffect(() => {
    if (checkout === "success" || syncedOnce.current || summary.data?.mode !== "enabled") return;
    syncedOnce.current = true;
    api
      .syncBilling()
      .then(apply, () => undefined)
      .finally(() => setInitialSyncDone(true));
  }, [summary.data, checkout]);

  const go = useMutation({
    mutationFn: (kind: "checkout" | "portal") => (kind === "checkout" ? api.startCheckout() : api.openPortal()),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => toast.error(err instanceof ApiError ? errorMessage(err.code).message : "うまくいきませんでした"),
  });

  if (summary.isPending) return <LoadingSkeleton />;
  if (summary.isError) return <ApiErrorScreen error={summary.error} onRetry={() => void summary.refetch()} />;
  const s = summary.data;
  const { title, body } = describe(s);
  const action = actionOf(s);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold max-md:hidden">契約と支払い</h1>
      {waiting && (
        <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">
          契約を確かめています…
        </p>
      )}
      {slow && (
        <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">
          確かめるのに時間がかかっています。少し待ってから開き直してください。
        </p>
      )}
      <SettingCard>
        <SettingRow label={title} description={body ?? undefined}>
          {action && (
            <Button
              size="sm"
              className="rounded-full"
              disabled={go.isPending || (action === "checkout" && s.mode === "enabled" && !initialSyncDone && checkout !== "success")}
              onClick={() => go.mutate(action)}
            >
              {go.isPending ? "支払いの画面に移っています…" : action === "checkout" ? "契約する" : "支払いの画面を開く"}
            </Button>
          )}
        </SettingRow>
      </SettingCard>
      {s.mode === "enabled" && s.state !== "exempt" && (
        <>
          <SettingCard>
            <SettingRow
              label="料金"
              description={`基本料金 月${yen(s.prices.base)}（アカウント1件目を含む）／2件目から1件につき月${yen(s.prices.extra)}（税込み）。アカウントの数は次の請求から反映し、日割りはしません`}
            />
          </SettingCard>
          <p className="text-sm text-muted-foreground">
            <Link to="/terms" className="underline underline-offset-4">
              利用規約
            </Link>
            ・
            <Link to="/legal/commerce" className="underline underline-offset-4">
              特定商取引法に基づく表記
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

// 使えない機能を直接開いたときの画面（specs/019-feature-switches contracts/ui-routes.md 3、FR-006）。
// 理由や料金の案内は出さない（プランが決まってから足す）。
import type { Feature } from "@meguru/shared";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { LoadingSkeleton } from "@/components/guards";
import { Button } from "@/components/ui/button";
import { featureOn, useAccountAccess } from "@/lib/use-account-access";

/**
 * 「この機能は今は使えません」と、ホームへ戻る道だけを出す。
 * @param props - accountId：ホームへ戻る先のアカウント（省略すると URL の :accountId）
 * @returns 使えない機能の画面
 */
export function FeatureUnavailable({ accountId }: { accountId?: string }) {
  const params = useParams<{ accountId: string }>();
  const id = accountId ?? params.accountId;
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-16 text-center" role="alert">
      <h1 className="text-lg font-semibold">この機能は今は使えません</h1>
      <Button asChild variant="outline" className="h-10 rounded-full md:h-9">
        <Link to={id ? `/accounts/${id}` : "/"}>ホームへ</Link>
      </Button>
    </div>
  );
}

/**
 * 機能のまとまりがOFFなら、画面の代わりに FeatureUnavailable を出す（画面を作らず、APIも呼ばない）。
 * OFFかがわかるまで画面を作らない（Accountの画面の枠が同じ値を先に読むので、ふだんは待たない）。
 * 守りは API の判定（FEATURE_DISABLED）にあり、ここは見た目だけ（research.md R6）。
 * @param props - feature：画面が属するまとまり、children：画面
 * @returns 画面か、使えない機能の画面
 */
export function RequireFeature({ feature, children }: { feature: Feature; children: ReactNode }) {
  const { accountId } = useParams<{ accountId: string }>();
  const { access, isPending } = useAccountAccess(accountId);
  if (isPending) return <LoadingSkeleton />;
  if (!featureOn(access, feature)) return <FeatureUnavailable accountId={accountId} />;
  return <>{children}</>;
}

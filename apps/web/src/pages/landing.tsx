// 「/」：中身を持たない振り分け用のルート（FR-004・FR-005、規則2）
import { useQuery } from "@tanstack/react-query";
import { errorMessage, isErrorCode } from "@threads-grower/shared";
import { useEffect, useRef } from "react";
import { Navigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";

/**
 * 「/」の振り分け（FR-004・FR-005、規則2）。最後に使った Account か、「アカウントを作る」へ置き換え遷移する。
 * callback から `/?error=…` で戻されたとき（許可の画面にいる間にアカウントが消された・state が使えない）は、
 * 移る前にエラーをトーストで出す（specs/012 contracts/ui-routes.md「振り分け」、PR #15 のCodexレビュー）。
 * @returns 遷移、読み込み中、またはエラーの案内
 */
export function Landing() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const [params] = useSearchParams();
  const error = params.get("error");
  const shown = useRef(false);
  useEffect(() => {
    if (!error || shown.current) return;
    shown.current = true;
    toast.error(errorMessage(isErrorCode(error) ? error : "INTERNAL_ERROR").message);
  }, [error]);

  if (me.isPending) return <LoadingSkeleton />;
  // 一度読めていれば、裏での取り直しの失敗では画面を差し替えず、手元の一覧で表示を続ける。
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  const target = me.data.landingAccountId ? `/accounts/${me.data.landingAccountId}` : "/accounts/new";
  return <Navigate to={target} replace />;
}

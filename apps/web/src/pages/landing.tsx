// 「/」：中身を持たない振り分け用のルート（FR-004・FR-005、規則2。specs/008 で編集者の待機の案内を足した）
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";
import { EditorWaiting } from "@/components/team/EditorWaiting";

/**
 * 「/」の振り分け（FR-004・FR-005、規則2）。最後に使った Account か、アカウント追加画面へ置き換え遷移する。
 * @returns 遷移、読み込み中、またはエラーの案内
 */
export function Landing() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  if (me.isPending) return <LoadingSkeleton />;
  // 一度読めていれば、裏での取り直しの失敗では画面を差し替えず、手元の一覧で表示を続ける。
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  // 担当がなく、自分のAccountも手伝い先もない編集者には、接続を求めずに待機の案内を出す（specs/008 FR-026）
  if (!me.data.landingAccountId && me.data.editorWaiting) return <EditorWaiting partnerName={me.data.editorWaiting.partnerName} />;
  const target = me.data.landingAccountId ? `/accounts/${me.data.landingAccountId}` : "/accounts/new";
  return <Navigate to={target} replace />;
}

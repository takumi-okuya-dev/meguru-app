// 「/」：入口の振り分け（specs/028-meguru-shell contracts/ui-routes.md 3）。
// 使っているアプリがあれば最後に使ったアプリのホームへ、0本ならすべてのアプリの画面へ移す。行き先は API が決める（/api/me の apps.landing）。
// クエリ（API から戻された ?error=… など）はそのまま渡す。
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useAppRegistry } from "../app-module";

/**
 * 入口の振り分け。最後に使ったアプリのホームか、すべてのアプリの画面へ、クエリを保って置き換えで移す。
 * @returns 移る、読み込み中、またはエラーの案内
 */
export function ShellLanding() {
  const apps = useAppRegistry();
  const { search } = useLocation();
  // 開くたびに読み直し、届くまで行き先を決めない（古い値で決めると、使わなくなったアプリへ戻ることがある）
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, refetchOnMount: "always" });
  if (me.isPending || me.isFetching) return <LoadingSkeleton />;
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  const landing = apps.find((a) => a.id === me.data.apps?.landing);
  return <Navigate to={landing ? `${landing.basePath}${search}` : `/apps${search}`} replace />;
}

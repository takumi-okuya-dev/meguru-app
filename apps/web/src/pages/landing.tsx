// 「/」：中身を持たない振り分け用のルート（FR-004・FR-005、規則2）
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { LoadingSkeleton } from "@/components/guards";

export function Landing() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  if (me.isPending) return <LoadingSkeleton />;
  if (me.isError) return <LoadingSkeleton />;
  const target = me.data.landingAccountId ? `/accounts/${me.data.landingAccountId}` : "/accounts/new";
  return <Navigate to={target} replace />;
}

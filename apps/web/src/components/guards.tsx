// ルートのガード（contracts/ui-routes.md「遷移の規則」）
import { useAuth } from "@clerk/react";
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router";
import { ClerkLoadFailedScreen } from "@/components/ErrorScreen";
import { CLERK_LOAD_TIMEOUT_MS } from "@/lib/config-check";

/** 読み込み中は骨組みだけを表示し、データは出さない（規則1） */
export function LoadingSkeleton() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true" data-testid="loading">
      <div className="h-2 w-24 animate-pulse rounded bg-muted" />
    </div>
  );
}

/** 読み込みが一定時間終わらなければ true（読み込み中のまま止めないため） */
export function useLoadTimeout(isLoaded: boolean, ms: number = CLERK_LOAD_TIMEOUT_MS) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isLoaded) return;
    const t = setTimeout(() => setTimedOut(true), ms);
    return () => clearTimeout(t);
  }, [isLoaded, ms]);
  return !isLoaded && timedOut;
}

/** 未ログインのガード：内容を描画する前に /sign-in へ置き換え遷移する（FR-003、規則1） */
export function RequireAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  const timedOut = useLoadTimeout(Boolean(isLoaded));
  if (timedOut) return <ClerkLoadFailedScreen />;
  if (!isLoaded) return <LoadingSkeleton />;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <Outlet />;
}

// ルートのガード（contracts/ui-routes.md「遷移の規則」）
import { useAuth } from "@clerk/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ClerkLoadFailedScreen } from "@/components/ErrorScreen";
import { CLERK_LOAD_TIMEOUT_MS } from "@/lib/config-check";
import { WithdrawalInProgress } from "@/components/billing/WithdrawalInProgress";
import { SubscribeRequired } from "@/components/billing/SubscribeRequired";
import { TestAccessRequired } from "@/components/TestAccessRequired";
import {
  getSubscriptionRequired,
  getTestAccessRequired,
  getWithdrawalInProgress,
  subscribeSubscriptionRequired,
  subscribeTestAccessRequired,
  subscribeWithdrawalInProgress,
} from "@/lib/api-client";

/** 契約前でも開ける画面（契約と支払い＝Checkoutからの戻り先、退会のあるアカウント。specs/024 contracts/ui-routes.md 1）。 */
const SUBSCRIBE_ALLOWED_PATHS = ["/settings/billing", "/settings/account"];

/**
 * 読み込み中の骨組み。データは出さない（規則1）。
 * @returns 読み込み中の表示
 */
export function LoadingSkeleton() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true" data-testid="loading">
      <div className="h-2 w-24 animate-pulse rounded bg-muted" />
    </div>
  );
}

/**
 * 読み込みが一定時間終わらないかを判定する（読み込み中のまま止めないため）。
 * @param isLoaded - 読み込みが終わったか
 * @param ms - 待つ上限（ミリ秒）
 * @returns 時間切れなら true
 */
export function useLoadTimeout(isLoaded: boolean, ms: number = CLERK_LOAD_TIMEOUT_MS) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isLoaded) return;
    const t = setTimeout(() => setTimedOut(true), ms);
    return () => clearTimeout(t);
  }, [isLoaded, ms]);
  return !isLoaded && timedOut;
}

/**
 * 未ログインのガード。内容を描画する前に /sign-in へ置き換え遷移する（FR-003、規則1）。
 * Clerk の読み込みが一定時間終わらなければ、案内の画面を出す。
 * @returns 子のルート、または読み込み中・案内・ログイン画面への遷移
 */
export function RequireAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  const withdrawing = useSyncExternalStore(subscribeWithdrawalInProgress, getWithdrawalInProgress);
  const testAccessRequired = useSyncExternalStore(subscribeTestAccessRequired, getTestAccessRequired);
  const subscriptionRequired = useSyncExternalStore(subscribeSubscriptionRequired, getSubscriptionRequired);
  const { pathname } = useLocation();
  const timedOut = useLoadTimeout(Boolean(isLoaded));
  if (timedOut) return <ClerkLoadFailedScreen />;
  if (!isLoaded) return <LoadingSkeleton />;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  // 退会の途中なら、退会を終える画面だけを出す（specs/013 research.md R10）
  if (withdrawing) return <WithdrawalInProgress />;
  // テスト版に入れない人は、招待された方だけが使えると出す（specs/016 contracts/ui-routes.md 2）
  if (testAccessRequired) return <TestAccessRequired />;
  // 契約前の人は、契約してから使い始める（無料体験なし。specs/024 FR-029）
  if (subscriptionRequired && !SUBSCRIBE_ALLOWED_PATHS.includes(pathname)) return <SubscribeRequired />;
  return <Outlet />;
}

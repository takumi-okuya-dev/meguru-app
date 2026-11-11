// ルートのガード（contracts/ui-routes.md「遷移の規則」）
import { useAuth } from "@clerk/react";
import { useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ClerkLoadFailedScreen } from "@/components/ErrorScreen";
import { LoadingSkeleton, useLoadTimeout } from "@/components/LoadingSkeleton";
import { WithdrawalInProgress } from "@/shell/guards/WithdrawalInProgress";
import { SubscribeRequired } from "@/shell/guards/SubscribeRequired";
import { TestAccessRequired } from "@/shell/guards/TestAccessRequired";
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

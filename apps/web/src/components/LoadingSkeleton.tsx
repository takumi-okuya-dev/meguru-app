// 読み込み中の骨組みと、読み込みの時間切れの判定（contracts/ui-routes.md「遷移の規則」）。どの画面からも使う共通の部品
import { useEffect, useState } from "react";
import { CLERK_LOAD_TIMEOUT_MS } from "@/lib/config-check";

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

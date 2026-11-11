// 前のURLの転送（specs/028-meguru-shell contracts/ui-routes.md 2、research.md R4）。
// URLの頭を置き換え、パスの残り・クエリ・ページ内の位置（#…）を保って、履歴を置き換えて移す。ログインの関所の外に置く。
import { Navigate, useLocation } from "react-router";

/**
 * 前のURLの頭（from）を、新しいURLの頭（to）に置き換えて移る。
 * @param props - from：前のURLの頭（例：/accounts）、to：新しいURLの頭（例：/threads/accounts）
 * @returns 移る
 */
export function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.startsWith(from) ? pathname.slice(from.length) : "";
  return <Navigate to={`${to}${rest}${search}${hash}`} replace />;
}

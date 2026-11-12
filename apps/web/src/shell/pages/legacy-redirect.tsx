// 前のURLの転送（specs/028-meguru-shell contracts/ui-routes.md 2、research.md R4）。
// URLの頭を置き換え、パスの残り・クエリ・ページ内の位置（#…）を保って、履歴を置き換えて移す。ログインの関所の外に置く。
import { Navigate, useLocation, useParams } from "react-router";

/**
 * 前のURLの頭を、新しいURLの頭（to）に置き換えて移る。ルートは `<前の頭>/*` に置き、パスの残りはルーターが取り出した値（*）を使う
 * （ルーターは大文字・小文字を区別せずに合わせるので、自分で頭を切り取ると、/Accounts/12 のようなURLで残りを失う）。
 * @param props - to：新しいURLの頭（例：/threads/accounts）
 * @returns 移る
 */
export function LegacyRedirect({ to }: { to: string }) {
  const rest = useParams()["*"] ?? "";
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${rest ? `/${rest}` : ""}${search}${hash}`} replace />;
}

// 「/」：入口の振り分け（specs/028-meguru-shell contracts/ui-routes.md 3）。
// PR2 では、出せるアプリのホームへ移すだけ（今はThreadsだけ）。使っているアプリと最後に使ったアプリでの振り分けは PR3 で入れる。
// クエリ（API から戻された ?error=… など）はそのまま渡す。
import { Navigate, useLocation } from "react-router";
import { useAppRegistry } from "../app-module";
import { NotFound } from "./not-found";

/**
 * 入口の振り分け。出せるアプリのホームへ、クエリを保って置き換えで移す。
 * @returns 移る（出せるアプリがなければ「見つかりません」）
 */
export function ShellLanding() {
  const apps = useAppRegistry();
  const { search } = useLocation();
  const home = apps[0]?.basePath;
  if (!home) return <NotFound />;
  return <Navigate to={`${home}${search}`} replace />;
}

// 「ホームへ」の戻る先を、アカウントの画面のルートの段で渡す（specs/028-meguru-shell research.md R1）。
// 画面の中の早い段階のエラー（アカウントを読めない・権限がない）でも、分割の前と同じくこのアカウントのホームへ戻れるよう、
// 画面より外側のルートの入れ物で URL の :accountId から決める。
import { Outlet, useParams } from "react-router";
import { HomeLinkProvider } from "@/lib/home-link";
import { accountHomePath } from "../lib/paths";

/**
 * URL の :accountId から「ホームへ」の戻る先を決めて、中の画面に渡す。
 * @returns 中の画面
 */
export function AccountHomeLink() {
  const { accountId } = useParams<{ accountId: string }>();
  return (
    <HomeLinkProvider value={accountId ? accountHomePath(accountId) : "/"}>
      <Outlet />
    </HomeLinkProvider>
  );
}

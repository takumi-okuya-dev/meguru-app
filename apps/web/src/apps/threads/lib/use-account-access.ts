// Accountでの役割と権限（specs/008-team-operations contracts/permissions.md「画面での出し分け」、contracts/ui-routes.md「共通の振る舞い」）。
// 出し分けは見た目のためだけで、守りはAPIの判定にある（FR-003）。
import { ACCOUNT_ACCESS_LOST_MESSAGE, type AccountAccessResponse, type Feature, type Permission } from "@meguru/shared";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { setAccountAccessErrorListener, type AccountAccessErrorListener } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { queryKeys } from "@/lib/query";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";
import { threadsHomePath } from "@/apps/threads/lib/paths";

/**
 * 表示中のAccountでの役割と権限を読む。
 * @param accountId - accounts.id
 * @returns access（読み込み前はundefined）と、権限を確かめる can
 */
export function useAccountAccess(accountId: string | undefined) {
  const query = useQuery({
    queryKey: threadsQueryKeys.access(accountId ?? ""),
    queryFn: () => threadsApi.accountAccess(accountId!),
    enabled: Boolean(accountId),
  });
  return { access: query.data, isPending: query.isPending, can: (p: Permission) => canDo(query.data, p) };
}

/**
 * 権限があるかを確かめる。読み込み前は「ない」とする（操作のボタンを出さない）。
 * @param access - 役割と権限
 * @param permission - 確かめる権限
 * @returns あれば true
 */
export function canDo(access: AccountAccessResponse | undefined, permission: Permission): boolean {
  return access?.permissions.includes(permission) ?? false;
}

/**
 * 機能のまとまりがONか（specs/019 research.md R6）。読み込み前は「OFFとはわかっていない」として true にする
 * （設定のない人の画面が、読み込みのたびに一瞬消えないように）。中身を読む前に確かめたいときは、読み込み後に使う。
 * @param access - 役割と権限
 * @param feature - 確かめるまとまり
 * @returns OFFとわかっていなければ true
 */
export function featureOn(access: AccountAccessResponse | undefined, feature: Feature): boolean {
  return access?.features.includes(feature) ?? true;
}

/**
 * Accountの API の権限・存在のエラーを扱う関数を作る（contracts/ui-routes.md「共通の振る舞い」2・3）。
 * - 403 ROLE_FORBIDDEN：役割と表示中のAccountのデータを読み直す（文言は各画面のエラーの扱いが出す）
 * - 404 ACCOUNT_NOT_FOUND（表示中のAccount）：「このアカウントを開けなくなりました」と出して `/` へ移す
 * @param ctx - 表示中のAccount、QueryClient、画面の移動
 * @returns 受け取る関数
 */
export function makeAccountAccessErrorHandler(ctx: {
  accountId: string;
  queryClient: QueryClient;
  navigate: (to: string) => void;
}): AccountAccessErrorListener {
  return (code, accountId) => {
    if (accountId !== ctx.accountId) return;
    if (code === "ROLE_FORBIDDEN") {
      void ctx.queryClient.invalidateQueries({ queryKey: threadsQueryKeys.account(accountId) });
      return;
    }
    toast.error(ACCOUNT_ACCESS_LOST_MESSAGE, { id: "account-access-lost" });
    void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.me });
    ctx.navigate(threadsHomePath());
  };
}

/**
 * 表示中のAccountで、APIの権限・存在のエラーを受け取る。Accountの画面の親で1回だけ呼ぶ。
 * @param accountId - 表示中のAccount
 */
export function useAccountAccessErrors(accountId: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (!accountId) return;
    setAccountAccessErrorListener(makeAccountAccessErrorHandler({ accountId, queryClient, navigate }));
    return () => setAccountAccessErrorListener(null);
  }, [accountId, queryClient, navigate]);
}

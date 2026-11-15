// 未接続のアカウントで、Threadsが要る機能の代わりに出す案内（specs/012 FR-033・FR-034、contracts/ui-routes.md）。
import { CircleDashedIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useAccountAccess } from "@/apps/threads/lib/use-account-access";
import { accountPath } from "@/apps/threads/lib/paths";

/**
 * 「Threadsとの接続」の区分へのパス。
 * @param accountId - アカウント
 * @returns パス
 */
export const connectPath = (accountId: string) => accountPath(accountId, "settings#threads");

/**
 * 「Threadsにつなぐと使えます」の案内。オーナーには「Threadsとの接続」への入口を添える（つなぐのはオーナーだけ。FR-015）。
 * @param props - accountId：アカウント、message：案内の文（既定は「Threadsにつなぐと使えます」）、id：説明として参照させるときのID
 * @returns 案内
 */
export function NotConnectedNotice({ accountId, message = "Threadsにつなぐと使えます", id }: { accountId: string; message?: string; id?: string }) {
  const { can } = useAccountAccess(accountId);
  return (
    <div role="status" id={id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
      <CircleDashedIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">{message}</span>
      {can("owner") && (
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <Link to={connectPath(accountId)}>Threadsとの接続</Link>
        </Button>
      )}
    </div>
  );
}

/**
 * ホームの一番上の控えめな帯（Clarifications 2026-10-14）。
 * @param props - accountId：アカウント
 * @returns 帯
 */
export function NotConnectedBanner({ accountId }: { accountId: string }) {
  const { can } = useAccountAccess(accountId);
  return (
    <section
      aria-label="Threadsとの接続"
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted px-4 py-2.5 text-[13px]"
    >
      <span className="flex-1 text-muted-foreground">未接続：Threadsにつなぐと、承認した案を自動で投稿し、反応を分析できます</span>
      {can("owner") && (
        <Link className="font-medium underline underline-offset-4" to={connectPath(accountId)}>
          Threadsにつなぐ
        </Link>
      )}
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "@/lib/api-client";
import { formatRelativeJst } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { ReconnectButton } from "@/apps/threads/components/ReconnectButton";
import { accountPath } from "@/apps/threads/lib/paths";

/**
 * ホームに、次の投稿と準備できている件数を出す（005 FR-022）。
 * @param props - accountId：AccountのID
 * @returns 次の投稿のカード
 */
export function NextPostCard({ accountId }: { accountId: string }) {
  const query = useQuery({
    queryKey: queryKeys.autoPost(accountId),
    queryFn: () => api.getAutoPost(accountId),
  });
  const data = query.data;
  if (!data)
    return query.isError ? null : (
      <div className="h-32 w-full animate-pulse rounded-2xl bg-muted" aria-busy="true" />
    );
  const rateNotice = data.notices.find((n) => n.kind === "rate_limited");
  const stock = accountPath(accountId, "stock?tab=approved");
  return (
    <section className="w-full space-y-2 rounded-2xl border bg-card p-4 md:p-5">
      <h2 className="font-semibold">{data.autoPost.enabled ? "次の投稿" : "自動投稿はオフです"}</h2>
      {!data.autoPost.enabled ? (
        <>
          <p className="text-sm text-muted-foreground">
            承認済みの下書きを、決めた時刻に自動で投稿できます
          </p>
          <Button asChild variant="outline">
            <Link to={accountPath(accountId, "settings")}>投稿のスケジュールを設定する</Link>
          </Button>
        </>
      ) : data.autoPost.stoppedReason === "billing_inactive" ? (
        // オーナーが読むだけ（specs/013 research.md R8）。理由は画面の上の帯に出す
        <p className="text-sm text-warning">このアカウントは今、読むだけのため、自動投稿を止めています</p>
      ) : data.autoPost.stoppedReason === "needs_reconnect" ? (
        <>
          <p className="text-sm text-destructive">
            Threadsとの接続が切れているため、自動投稿を止めています。再接続してください
          </p>
          <ReconnectButton accountId={accountId} />
        </>
      ) : data.autoPost.stoppedReason === "rate_limited" ? (
        <p className="text-sm text-warning">
          Threadsの投稿数の上限に達したため、今日の投稿を止めました。
          {rateNotice && formatRelativeJst(rateNotice.until)}から再開します
        </p>
      ) : (
        <>
          {data.next ? (
            <>
              <p className="text-xl font-semibold">{formatRelativeJst(data.next.at)}</p>
              <p className="line-clamp-2 break-words text-sm">{data.next.draft.excerpt}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.approvedCount ? "投稿の処理中です" : "承認済みの下書きがありません"}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            承認済み {data.approvedCount}件{data.daysLeft !== null && `・あと${data.daysLeft}日分`}
          </p>
          <Button asChild variant="outline">
            <Link to={stock}>投稿ストックを開く</Link>
          </Button>
        </>
      )}
    </section>
  );
}

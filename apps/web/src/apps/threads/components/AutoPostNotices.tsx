import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { blockedReasonLabel, PUBLISH_ERROR_LABELS } from "@meguru/shared";
import { Link } from "react-router";
import { api, describeError } from "@/lib/api-client";
import { formatRelativeJst } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { useAccountAccess } from "@/apps/threads/lib/use-account-access";
import { NotConnectedNotice } from "@/apps/threads/components/NotConnectedNotice";
import { ReconnectButton } from "@/apps/threads/components/ReconnectButton";
import { Button } from "@/components/ui/button";

/**
 * ホームと投稿ストックに出す自動投稿の知らせ。手伝う人には、権限のない操作を出さない
 * （「閉じる」は review、再接続は owner。specs/008 contracts/permissions.md。PR #9 のCodexレビュー）。
 * @param props - accountId：AccountのID、hideNotConnected：未接続の知らせを出さない（ホームは上の帯で出す。specs/012）
 * @returns 知らせ。読み込み失敗時は再試行の案内
 */
export function AutoPostNotices({ accountId, hideNotConnected = false }: { accountId: string; hideNotConnected?: boolean }) {
  const client = useQueryClient();
  const { can } = useAccountAccess(accountId);
  const query = useQuery({
    queryKey: queryKeys.autoPost(accountId),
    queryFn: () => api.getAutoPost(accountId),
  });
  const dismiss = useMutation({
    mutationFn: () => api.dismissBlockedNotice(accountId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.autoPost(accountId) }),
  });
  if (query.isError)
    return (
      <p className="text-sm text-muted-foreground">
        自動投稿の状態を読み込めませんでした。
        <Button variant="ghost" onClick={() => void query.refetch()}>
          再読み込み
        </Button>
      </p>
    );
  return (
    <div className="w-full space-y-2">
      {query.data?.notices.map((notice) => {
        if (notice.kind === "no_approved")
          return (
            <p
              key={notice.kind}
              role="status"
              className="rounded-xl border bg-muted/40 px-4 py-3 text-sm"
            >
              承認済みの下書きがありません。
              {notice.nextSlotAt
                ? `次の投稿の時刻（${formatRelativeJst(notice.nextSlotAt)}）までに承認してください`
                : "下書きを用意して承認してください"}
            </p>
          );
        if (notice.kind === "blocked")
          return (
            <div
              key={notice.kind}
              role="status"
              className="space-y-2 rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm"
            >
              <p>
                投稿の直前に{blockedReasonLabel(notice.latestReason, notice.latestWords)}
                が見つかったため、{notice.count}件を要確認に戻しました
              </p>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/threads/accounts/${accountId}/stock`}>確認する</Link>
                </Button>
                {can("review") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate()}
                  >
                    閉じる
                  </Button>
                )}
              </div>
              {dismiss.isError && <p role="alert">{describeError(dismiss.error)}</p>}
            </div>
          );
        // 未接続：承認した案は、つないで自動投稿をオンにすると投稿される（specs/012 FR-033）
        if (notice.kind === "not_connected")
          return hideNotConnected ? null : (
            <NotConnectedNotice
              key={notice.kind}
              accountId={accountId}
              message="承認した案は、Threadsにつないで自動投稿をオンにすると投稿されます"
            />
          );
        if (notice.kind === "needs_reconnect")
          return (
            <div
              key={notice.kind}
              role="status"
              className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
            >
              {can("owner") ? (
                <>
                  <p>Threadsとの接続が切れているため、自動投稿を止めています。再接続してください</p>
                  <ReconnectButton accountId={accountId} />
                </>
              ) : (
                // 再接続はオーナーだけができる（specs/008 FR-044）
                <p>Threadsとの接続が切れているため、自動投稿を止めています。オーナーの再接続を待っています</p>
              )}
            </div>
          );
        if (notice.kind === "rate_limited")
          return (
            <p
              key={notice.kind}
              role="status"
              className="rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm"
            >
              Threadsの投稿数の上限に達したため、今日の投稿を止めました。
              {formatRelativeJst(notice.until)}から再開します
            </p>
          );
        if (notice.kind === "publish_failed")
          return (
            <div
              key={notice.kind}
              role="status"
              className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
            >
              <p>
                {notice.count}件の投稿に失敗しました（{PUBLISH_ERROR_LABELS[notice.latestError]}）
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to={`/threads/accounts/${accountId}/stock?tab=approved#publish-failed`}>
                  確認する
                </Link>
              </Button>
            </div>
          );
        return null;
      })}
    </div>
  );
}

// 「このアカウントの設定」の「投稿のスケジュール」の区分（specs/005-auto-post FR-001〜FR-004・FR-002b、contracts/ui-routes.md）。
// 見た目は「投稿のルール」と同じ（小見出し、角の丸い枠、枠の中を線で区切った行）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  THREADS_CHECK_MESSAGES,
  threadsCheckOkMessage,
  type AccountSummary,
  type PostingSchedule,
  type ThreadsCheck,
} from "@threads-grower/shared";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { formatRelativeJst, formatSlotTime } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { PostingScheduleDialog } from "./PostingScheduleDialog";
import { SettingCard, SettingRow } from "./SettingRow";

/**
 * 保存の後の通知の文言。オンにしたときは次の投稿の予定を添える（contracts/ui-routes.md）。
 * @param accountId - Account の ID
 * @param schedule - 保存した設定
 * @returns 通知の文言
 */
async function savedMessage(accountId: string, schedule: PostingSchedule): Promise<string> {
  const base = "投稿のスケジュールを保存しました";
  if (!schedule.enabled) return base;
  try {
    const status = await api.getAutoPost(accountId);
    if (status.next) return `${base}。次の投稿は${formatRelativeJst(status.next.at)}の予定です`;
    if (status.notices.some((n) => n.kind === "no_approved"))
      return `${base}。承認済みの下書きを用意してください`;
  } catch {
    // 予定を読めなくても、保存はできている
  }
  return base;
}

/**
 * 「投稿のスケジュール」の区分。自動投稿・投稿する時刻・時刻を少しずらすの3つの行と、「接続を確かめる」。
 * 設定の権限がない人（任されていないパートナー・編集者）には、読むだけで出す（specs/008 FR-041）。
 * @param props - account：Account、canEdit：設定の権限、canReconnect：再接続できる（オーナー）、onReconnect：再接続を始める
 * @returns 区分
 */
export function PostingScheduleSection({
  account,
  canEdit = true,
  canReconnect = true,
  onReconnect,
}: {
  account: AccountSummary;
  canEdit?: boolean;
  canReconnect?: boolean;
  onReconnect: () => void;
}) {
  const accountId = account.id;
  const query = useQuery({
    queryKey: queryKeys.postingSchedule(accountId),
    queryFn: () => api.getPostingSchedule(accountId),
  });
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const schedule = query.data?.schedule;

  const check = useMutation({
    mutationFn: () => api.checkThreads(accountId),
    onSuccess: (r) => {
      // 要再接続になったら、接続の状態の表示も読み直す
      if (r.status === "needs_reconnect")
        void queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
    },
  });

  const onSaved = async (saved: PostingSchedule, connectionCheck: ThreadsCheck | null) => {
    setEditing(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.postingSchedule(accountId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.autoPost(accountId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) }),
    ]);
    if (connectionCheck?.status === "unknown") {
      toast.warning(
        "保存しました。Threadsとの接続は確認できませんでした。「接続を確かめる」で、あとで確かめてください",
      );
      return;
    }
    toast.success(await savedMessage(accountId, saved));
  };

  const checkResult = check.data;
  const times = schedule?.slotTimes ?? [];

  return (
    <section aria-labelledby="posting-schedule-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="posting-schedule-heading" className="font-medium">
          投稿のスケジュール
        </h2>
        {canEdit && (
          <Button
            variant="outline"
            className="h-10 rounded-full md:h-9"
            disabled={!schedule}
            onClick={() => setEditing(true)}
          >
            編集
          </Button>
        )}
      </div>
      {!canEdit && <p className="text-xs text-muted-foreground">変更できるのはオーナーです</p>}
      {account.connectionStatus === "needs_reconnect" && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
            <span className="flex-1">
              {canReconnect
                ? "Threadsとの接続が切れているため、自動投稿は止まっています"
                : "Threadsとの接続が切れているため、自動投稿は止まっています。オーナーの再接続を待っています"}
            </span>
            {canReconnect && (
              <Button size="sm" className="rounded-full" onClick={onReconnect}>
                再接続
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {query.isError ? (
        <p className="text-sm text-muted-foreground">
          読み込めませんでした。{" "}
          <button
            type="button"
            className="text-ring underline"
            onClick={() => void query.refetch()}
          >
            再読み込み
          </button>
        </p>
      ) : (
        <SettingCard>
          <SettingRow
            label="自動投稿"
            description={
              schedule
                ? schedule.enabled
                  ? "承認済みの下書きを、下の時刻に1件ずつ投稿します"
                  : "オフです。承認済みの下書きは投稿されません"
                : ""
            }
          >
            <span className="text-sm">{schedule ? (schedule.enabled ? "オン" : "オフ") : ""}</span>
          </SettingRow>
          <SettingRow
            label="投稿する時刻"
            description={
              schedule
                ? times.length > 0
                  ? `${times.map(formatSlotTime).join("・")}（1日${times.length}件）`
                  : "未設定"
                : ""
            }
          />
          <SettingRow
            label="時刻を少しずらす"
            description="機械的に見えないよう、前後10分の中でずらして投稿します"
          >
            <span className="text-sm">{schedule ? (schedule.jitter ? "オン" : "オフ") : ""}</span>
          </SettingRow>
        </SettingCard>
      )}

      {canEdit && (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          className="h-10 rounded-full md:h-9"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending ? "確かめています…" : "接続を確かめる"}
        </Button>
        {check.isError && (
          <span className="text-sm text-destructive">{THREADS_CHECK_MESSAGES.unknown}</span>
        )}
        {checkResult && !check.isPending && (
          <span
            role="status"
            className={cn(
              "flex flex-wrap items-center gap-2 text-sm",
              checkResult.status === "ok"
                ? "text-success"
                : checkResult.status === "unknown"
                  ? "text-muted-foreground"
                  : "text-destructive",
            )}
          >
            {checkResult.status === "ok"
              ? threadsCheckOkMessage(checkResult.quotaUsage, checkResult.quotaTotal)
              : THREADS_CHECK_MESSAGES[checkResult.status]}
            {canReconnect && (checkResult.status === "needs_reconnect" ||
              checkResult.status === "no_publish_permission") && (
              <Button size="sm" className="rounded-full" onClick={onReconnect}>
                再接続
              </Button>
            )}
          </span>
        )}
      </div>
      )}

      {editing && schedule && (
        <PostingScheduleDialog
          accountId={accountId}
          schedule={schedule}
          onSaved={(s, c) => void onSaved(s, c)}
          onReconnect={onReconnect}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

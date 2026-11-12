// 「チームを作る」のダイアログ（specs/011-team-revision FR-010、contracts/ui-routes.md「チームを作る」）。
// 名前（1〜50文字）と、チームに入れる自分のアカウント（1つ以上）を選ぶ。作った人が管理者になる。
// 追加のダイアログなので、ほかの追加・編集と同じ枠（FormDialogFrame。docs/ui-design.md 型B）を使う。
// スマートフォンでは全画面のシート（左上に✕、右上に「作る」）になり、中身に余白が付く（2026-11-03）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TEAM_NAME_MAX, countChars } from "@meguru/shared";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AccountAvatar } from "@/apps/threads/components/AccountAvatar";
import { FormDialogFrame } from "@/apps/threads/components/items/FormDialogFrame";
import { ApiError, describeError } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { cn } from "@/lib/utils";
import { accountPath, teamPath } from "@/apps/threads/lib/paths";
import { useThreadsMe } from "@/apps/threads/lib/use-threads-me";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";

/**
 * チームを作るダイアログ。
 * @param props - onClose：閉じる、onCreated：作った後（ドロワーを閉じるなど）、initialAccountId：初めから選んでおくアカウント
 * @returns ダイアログ
 */
export function CreateTeamDialog({
  onClose,
  onCreated,
  initialAccountId,
}: {
  onClose: () => void;
  onCreated?: () => void;
  initialAccountId?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useThreadsMe();
  const own = (me.data?.accounts ?? []).filter((a) => a.role === "owner");
  // 未接続のアカウントはチームに入れられない（specs/012 FR-050・FR-051）
  const connectedIds = new Set(own.filter((a) => a.connectionStatus !== "not_connected").map((a) => a.id));
  const noConnected = me.data !== undefined && connectedIds.size === 0;
  // つなぐ入口は、開いた画面のアカウントを優先する（名前は重なりうるので、ほかのアカウントへ移らないように。PR #15 のCodexレビュー）
  const connectTarget =
    own.find((a) => a.id === initialAccountId && !connectedIds.has(a.id)) ?? own.find((a) => !connectedIds.has(a.id));
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialAccountId ? [initialAccountId] : []));
  const chosen = [...picked].filter((id) => connectedIds.has(id));
  // ほかのチームに入っていたアカウント（作るときに分かったもの）
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const length = countChars(name.trim());
  const nameOk = length >= 1 && length <= TEAM_NAME_MAX;
  const create = useMutation({
    mutationFn: () => threadsApi.createTeam({ name, accountIds: chosen }),
    onSuccess: async ({ teamId }) => {
      await queryClient.invalidateQueries({ queryKey: threadsQueryKeys.me });
      onClose();
      onCreated?.();
      void navigate(teamPath(teamId));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "ACCOUNT_IN_OTHER_TEAM") {
        setBusy(new Set(err.details));
        setPicked((prev) => new Set([...prev].filter((id) => !err.details.includes(id))));
      }
    },
  });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <FormDialogFrame
      title="チームを作る"
      description="チーム名と、チームに入れる自分のアカウントを選びます"
      submitLabel="作る"
      submitting={create.isPending}
      submitDisabled={!nameOk || chosen.length === 0}
      onSubmit={() => create.mutate()}
      onRequestClose={onClose}
    >
      <div className="space-y-5">
        {/* 作れなかった理由は、右上の「作る」から見える上に出す */}
        {create.isError && (
          <p role="alert" className="text-sm text-destructive">
            {describeError(create.error)}
          </p>
        )}
        <p className="text-sm text-foreground/80">
          あなたが管理者になります。招待リンクを送ると、受け取った人が自分のアカウントを入れて参加します。
        </p>
        <div className="space-y-1.5">
          <label htmlFor="team-name" className="text-sm font-medium">
            チーム名
          </label>
          <input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby="team-name-help"
            className="h-11 w-full rounded-xl border bg-background px-3 text-base md:text-sm"
          />
          <p id="team-name-help" className={cn("text-xs text-muted-foreground", length > TEAM_NAME_MAX && "text-destructive")}>
            1〜{TEAM_NAME_MAX}文字（{length}/{TEAM_NAME_MAX}）
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">チームに入れる自分のアカウント（1つ以上）</legend>
          {noConnected && (
            <div role="status" className="space-y-1.5 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
              <p>先にThreadsにつないでください。チームに入れられるのは、Threadsにつないだアカウントだけです。</p>
              {/* 「Threadsとの接続」へ進む入口（PR #15 のCodexレビュー） */}
              {connectTarget && (
                <Link
                  className="font-medium underline underline-offset-4"
                  to={accountPath(connectTarget.id, "settings#threads")}
                  onClick={onClose}
                >
                  「{connectTarget.name}」をThreadsにつなぐ
                </Link>
              )}
            </div>
          )}
          {own.map((a) => {
            const inOther = busy.has(a.id);
            const notConnected = !connectedIds.has(a.id);
            return (
              <label
                key={a.id}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2",
                  chosen.includes(a.id) && "border-foreground",
                  (inOther || notConnected) && "opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="size-5 accent-foreground"
                  checked={chosen.includes(a.id)}
                  disabled={inOther || notConnected}
                  aria-label={`${a.name}をチームに入れる`}
                  onChange={() => toggle(a.id)}
                />
                <AccountAvatar account={a} className="size-8" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {notConnected ? "Threadsにつなぐと入れられます" : a.username ? `@${a.username}` : ""}
                    {inOther ? " · ほかのチームに入っています" : ""}
                  </span>
                </span>
              </label>
            );
          })}
          <p className="text-xs text-muted-foreground">入れたアカウントは、初めはチームに見せません。あとから切り替えられます。</p>
        </fieldset>
      </div>
    </FormDialogFrame>
  );
}

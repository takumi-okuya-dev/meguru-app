// 時間差のメンションの設定（specs/023 contracts/ui-routes.md「このアカウントの設定」、モック「このアカウントの設定」）。
// 時間差・ひとこと・メンションする人（いつも付ける）。変えるのは settings の権限の人だけ。説明は閉じたトグル（FR-034）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MENTION_DELAY_OPTIONS, MENTION_MESSAGE_MAX, MENTION_PEOPLE_MAX, type MentionSettings } from "@meguru/shared";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { delayLabel } from "@/components/stock/MentionPanel";
import { ConfirmDialog } from "@/components/team/ConfirmDialog";
import { HelpToggle } from "@/components/team/HelpToggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { SettingCard, SettingRow } from "./SettingRow";

const HELP = [
  "承認すると、投稿と一緒に返信の文も承認されます",
  "同じ人へのメンションは、24時間に1回までです",
  "返信は数分遅れて出ることがあります",
  "相手がメンションを受けない設定だと、通知されないことがあります",
] as const;

/**
 * 時間差のメンションの区分。
 * @param props - accountId
 * @returns 区分
 */
export function MentionSettingsSection({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.mentionSettings(accountId), queryFn: () => api.mentionSettings(accountId) });
  const [message, setMessage] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState<MentionSettings["people"][number] | null>(null);
  const delayId = useId();
  const messageId = useId();
  const set = (s: MentionSettings) => queryClient.setQueryData(queryKeys.mentionSettings(accountId), s);
  const onError = (err: unknown) => toast.error(describeError(err));
  const saveSettings = useMutation({
    mutationFn: (v: { message: string; delayMinutes: number }) =>
      api.putMentionSettings(accountId, { expectedVersion: query.data?.version ?? null, ...v }),
    onSuccess: (s) => {
      set(s);
      setMessage(null);
    },
    onError,
  });
  const add = useMutation({
    mutationFn: () => api.addMentionPerson(accountId, { username, label }),
    onSuccess: (s) => {
      set(s);
      setUsername("");
      setLabel("");
    },
    onError,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; always: boolean }) => api.patchMentionPerson(accountId, v.id, { always: v.always }),
    onSuccess: set,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMentionPerson(accountId, id),
    onSuccess: (s) => {
      set(s);
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) });
    },
    onError,
  });

  const s = query.data;
  return (
    <section aria-labelledby="mention-heading" className="space-y-3">
      <h2 id="mention-heading" className="font-medium">
        時間差のメンション
      </h2>
      {s?.repliesDenied && (
        <Alert variant="warning">
          <AlertDescription className="text-foreground">
            今のトークンには返信の権限がありません。返信の権限を付けてトークンを作り直すと、使えるようになります。
            <Link to="/guide/threads-token" className="ml-1 text-ring underline">
              作り直し方
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {query.isError ? (
        <p className="text-sm text-muted-foreground">
          読み込めませんでした。{" "}
          <button type="button" className="text-ring underline" onClick={() => void query.refetch()}>
            再読み込み
          </button>
        </p>
      ) : !s ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      ) : (
        <SettingCard>
          <SettingRow label="時間差" description="投稿から、メンションの返信を出すまで">
            {s.canEdit ? (
              <select
                id={delayId}
                aria-label="時間差"
                value={s.delayMinutes}
                disabled={saveSettings.isPending}
                onChange={(e) => saveSettings.mutate({ message: s.message, delayMinutes: Number(e.target.value) })}
                className="h-10 rounded-lg border bg-background px-2 text-sm md:h-9"
              >
                {MENTION_DELAY_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {delayLabel(m)}後
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm">{delayLabel(s.delayMinutes)}後</span>
            )}
          </SettingRow>
          {message === null ? (
            <SettingRow label="ひとこと" description={s.message || "返信の文の初めに入ります（100文字まで）"}>
              {s.canEdit && (
                <Button variant="outline" className="h-10 rounded-full md:h-9" onClick={() => setMessage(s.message)}>
                  変更
                </Button>
              )}
            </SettingRow>
          ) : (
            <div className="space-y-2 px-4 py-3">
              <label htmlFor={messageId} className="text-sm font-medium">
                ひとこと
              </label>
              <Input id={messageId} value={message} maxLength={MENTION_MESSAGE_MAX} onChange={(e) => setMessage(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="rounded-full" onClick={() => setMessage(null)}>
                  やめる
                </Button>
                <Button
                  className="rounded-full"
                  disabled={saveSettings.isPending}
                  onClick={() => saveSettings.mutate({ message, delayMinutes: s.delayMinutes })}
                >
                  保存
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2 px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">メンションする人</span>
              <span className="text-xs text-muted-foreground">
                {s.people.length} / {MENTION_PEOPLE_MAX}人
              </span>
            </div>
            {s.people.length > 0 && (
              <ul aria-label="メンションする人" className="divide-y rounded-lg border">
                {s.people.map((p) => (
                  <li key={p.id} className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 text-sm">
                      {p.label} <span className="text-xs text-muted-foreground">@{p.username}</span>
                    </span>
                    <label className="inline-flex min-h-9 items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={p.always}
                        disabled={!s.canEdit || patch.isPending}
                        onChange={(e) => patch.mutate({ id: p.id, always: e.target.checked })}
                        className="size-4 accent-foreground"
                      />
                      いつも付ける
                    </label>
                    {s.canEdit && (
                      <button
                        type="button"
                        aria-label={`${p.label}を消す`}
                        onClick={() => (p.pendingCount > 0 ? setRemoving(p) : remove.mutate(p.id))}
                        className="flex size-9 items-center justify-center rounded-lg hover:bg-accent"
                      >
                        <XIcon className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {s.canEdit && s.people.length < MENTION_PEOPLE_MAX && (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  add.mutate();
                }}
              >
                <span className="inline-flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">@</span>
                  <Input aria-label="ユーザー名" placeholder="ユーザー名" value={username} onChange={(e) => setUsername(e.target.value)} className="w-44" />
                </span>
                <Input aria-label="呼び名" placeholder="呼び名（例：港の運営）" value={label} onChange={(e) => setLabel(e.target.value)} className="w-52" />
                <Button type="submit" variant="outline" className="h-10 rounded-full md:h-9" disabled={add.isPending || !username.trim() || !label.trim()}>
                  足す
                </Button>
              </form>
            )}
          </div>
        </SettingCard>
      )}
      <HelpToggle label="時間差のメンションについて" points={HELP} />
      {removing && (
        <ConfirmDialog
          title={`${removing.label}を消しますか？`}
          confirmLabel="外して消す"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onCancel={() => setRemoving(null)}
        >
          この人を含む予定のメンションが{removing.pendingCount}件あります。承認済みの投稿は要確認に戻り、投稿済みの予定は取りやめます。
        </ConfirmDialog>
      )}
    </section>
  );
}

// 時間差のメンション（specs/023 contracts/ui-routes.md、モック https://claude.ai/artifact/Wgz1WNWYUDdUXwn1GgS6GP ）。
// ポップアップは開かず、カードの中で1回押して付ける。人の入れ替えは丸いボタン、文はその場で直す。
// 投稿済みの投稿では「返信する」を押すことが返信の文の承認になる（原則II）。保存の前のNGワードは画面でも知らせる（原則I）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MENTION_FAILURE_LABELS,
  MENTION_PER_REPLY_MAX,
  MENTION_PUBLISHED_DAYS,
  buildMentionText,
  findNgWords,
  mentionUsernamesIn,
  toggleMentionInText,
  type MentionSettings,
  type NgWordForMatch,
  type PostMention,
} from "@threads-grower/shared";
import { AtSignIcon, CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api-client";
import { formatJstShort } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";

/** メンションを付ける相手（下書き・投稿済み）。 */
export type MentionTarget = {
  id: string;
  version: number;
  /** draft：要確認・承認済み、published：投稿済み */
  kind: "draft" | "published";
  mention: PostMention | null;
  publishedAt?: string | null;
  threadsMediaId?: string | null;
};

const LINK = "text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground";

/**
 * 時間差の表示（「30分」「3時間」）。
 * @param minutes - 分
 * @returns 表示
 */
export const delayLabel = (minutes: number) => (minutes < 60 ? `${minutes}分` : `${minutes / 60}時間`);

/**
 * メンションを付けられるか（人がいて、返信の権限がある）。
 * @param settings - メンションの設定
 * @returns 付けられるなら true
 */
export const mentionAvailable = (settings: MentionSettings | undefined): settings is MentionSettings =>
  !!settings && settings.people.length > 0 && !settings.repliesDenied;

/**
 * カードの中の時間差のメンション。
 * @param props - accountId、target：相手、settings：メンションの設定、ngWords：NGワード、canReview：付けられるか
 * @returns 枠。付けられない人・相手には何も出さない
 */
export function MentionPanel({
  accountId,
  target,
  settings,
  ngWords,
  canReview,
}: {
  accountId: string;
  target: MentionTarget;
  settings: MentionSettings | undefined;
  ngWords: readonly NgWordForMatch[];
  canReview: boolean;
}) {
  const queryClient = useQueryClient();
  const textId = useId();
  // 投稿済みで「メンションを付ける」を押したあと、まだ保存していない人と文。要確認で「いつも付ける」の人がいないときも使う
  const [local, setLocal] = useState<{ names: string[]; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.published(accountId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.mentionSettings(accountId) });
  };
  const save = useMutation({
    mutationFn: (body: { usernames: string[]; text?: string }) =>
      api.attachMention(accountId, target.id, { expectedVersion: target.version, ...body }),
    onSuccess: () => {
      setLocal(null);
      setEditing(null);
      refresh();
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.detachMention(accountId, target.id, target.kind === "draft" ? target.version : undefined),
    onSuccess: refresh,
    onError: (err) => toast.error(describeError(err)),
  });

  const m = target.mention;
  if (target.kind === "published" && m) return <PublishedStatus mention={m} canReview={canReview} busy={remove.isPending} onCancel={() => remove.mutate()} />;
  if (!canReview || !mentionAvailable(settings)) return null;
  if (target.kind === "published") {
    const tooOld = !target.publishedAt || Date.now() - Date.parse(target.publishedAt) > MENTION_PUBLISHED_DAYS * 86_400_000;
    if (!target.threadsMediaId || tooOld) return null;
  }

  const people = settings.people;
  const known = people.map((p) => p.username);
  const blocked = new Map(settings.blocked.filter((b) => b.draftId !== target.id).map((b) => [b.username, b.reason]));
  const always = people.filter((p) => p.always && !blocked.has(p.username)).map((p) => p.username).slice(0, MENTION_PER_REPLY_MAX);
  const busy = save.isPending || remove.isPending;

  const start = () => {
    if (target.kind === "draft" && always.length > 0) save.mutate({ usernames: always });
    else setLocal({ names: always, text: buildMentionText(settings.message, always) });
  };

  if (!m && !local) {
    return (
      <Button variant="outline" size="sm" className="h-11 self-start rounded-full md:h-8" disabled={busy} onClick={start}>
        <AtSignIcon className="size-4" aria-hidden="true" />
        メンションを付ける
      </Button>
    );
  }

  const saved = m !== null && m.state === "pending";
  const text = saved ? m.text : local!.text;
  const names = saved ? m.usernames : local!.names;
  const hits = findNgWords(text, [...ngWords]);

  const toggle = (u: string) => {
    const next = toggleMentionInText(text, u);
    const nextNames = mentionUsernamesIn(next, known);
    if (saved) {
      if (nextNames.length === 0) remove.mutate();
      else save.mutate({ usernames: nextNames, text: next });
    } else if (target.kind === "draft") {
      // 要確認でまだ保存していない：1人目を選んだら保存する
      if (nextNames.length > 0) save.mutate({ usernames: nextNames, text: next });
      else setLocal({ names: nextNames, text: next });
    } else setLocal({ names: nextNames, text: next });
  };
  const saveText = (value: string) => {
    const nextNames = mentionUsernamesIn(value, known);
    if (saved || target.kind === "draft") save.mutate({ usernames: nextNames.length > 0 ? nextNames : names, text: value });
    else {
      setLocal({ names: nextNames, text: value });
      setEditing(null);
    }
  };
  const heading =
    target.kind === "published"
      ? "今からメンションする"
      : `投稿の${delayLabel(m?.delayMinutes ?? settings.delayMinutes)}後にメンション`;

  return (
    <div
      role="group"
      aria-label="時間差でメンション"
      className={cn("space-y-2 rounded-xl px-3 py-2.5 text-[13px]", hits.length > 0 ? "bg-warning-bg" : "bg-muted")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{heading}</span>
        <button
          type="button"
          className={cn(LINK, "min-h-8")}
          disabled={busy}
          onClick={() => (saved ? remove.mutate() : setLocal(null))}
        >
          {target.kind === "published" ? "やめる" : "外す"}
        </button>
      </div>
      <div role="group" aria-label="メンションする人" className="flex flex-wrap gap-1.5">
        {people.map((p) => {
          const on = names.includes(p.username);
          const reason = !on ? blocked.get(p.username) : undefined;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              disabled={busy || reason !== undefined || (!on && names.length >= MENTION_PER_REPLY_MAX)}
              onClick={() => toggle(p.username)}
              className={cn(
                "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-[12px] md:h-8",
                on ? "border-foreground bg-foreground text-background" : "bg-background",
                reason && "border-dashed text-muted-foreground",
              )}
            >
              {on && <CheckIcon className="size-3" aria-hidden="true" />}
              {p.label}
              {reason && <span>（{reason === "recent" ? "24時間以内に済み" : "ほかの投稿で予定"}）</span>}
            </button>
          );
        })}
      </div>
      {editing !== null ? (
        <div className="space-y-1.5">
          <label htmlFor={textId} className="text-[12px] text-muted-foreground">
            返信の文
          </label>
          <textarea
            id={textId}
            rows={3}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            className="w-full resize-y rounded-lg border bg-background px-2.5 py-2 text-[13px]"
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing(null)}>
              やめる
            </Button>
            <Button size="sm" className="rounded-full" disabled={busy || editing.trim() === ""} onClick={() => saveText(editing)}>
              文を保存
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="min-w-0 whitespace-pre-wrap text-foreground/80">{text}</p>
          <span className="flex items-center gap-2">
            <button type="button" className={cn(LINK, "min-h-8")} onClick={() => setEditing(text)}>
              文を直す
            </button>
            {target.kind === "published" && (
              <Button
                size="sm"
                className="h-9 rounded-full md:h-8"
                disabled={busy || names.length === 0 || hits.length > 0}
                onClick={() => save.mutate({ usernames: names, text })}
              >
                返信する
              </Button>
            )}
          </span>
        </div>
      )}
      {hits.length > 0 && (
        <p className="text-[12px] text-warning">返信の文にNGワード「{hits.map((h) => h.word).join("・")}」があります</p>
      )}
      {target.kind === "published" && <p className="text-[12px] text-muted-foreground">「返信する」を押すと、数分以内にこの投稿へ返信します</p>}
    </div>
  );
}

/**
 * 投稿済みのメンションの状態（予定・済み・やめた・出せなかった）。
 * @param props - mention、canReview、busy、onCancel：やめる
 * @returns 状態の枠
 */
function PublishedStatus({
  mention,
  canReview,
  busy,
  onCancel,
}: {
  mention: PostMention;
  canReview: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const names = mention.usernames.map((u) => `@${u}`).join("・");
  if (mention.state === "canceled")
    return <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">メンションをやめました（{names}）</p>;
  if (mention.state === "failed")
    return (
      <p role="status" className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
        時間差でメンション：出せませんでした（{MENTION_FAILURE_LABELS[mention.failureReason ?? "error"]}）
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted px-3 py-2.5 text-[13px]">
      <span className="font-medium">時間差でメンション</span>
      <span>{names}</span>
      {mention.state === "sent" ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CheckIcon className="size-3.5" aria-hidden="true" />
          {mention.sentAt && formatJstShort(mention.sentAt)} に返信済み
        </span>
      ) : (
        <span className="text-muted-foreground">{mention.dueAt ? `${formatJstShort(mention.dueAt)} に返信予定` : "返信予定"}</span>
      )}
      {mention.state === "sent" && mention.replyPermalink && (
        <a className="ml-auto text-ring underline" href={mention.replyPermalink} target="_blank" rel="noopener noreferrer">
          返信を開く
        </a>
      )}
      {mention.state === "pending" && canReview && (
        <Button variant="outline" size="sm" className="ml-auto rounded-full" disabled={busy} onClick={onCancel}>
          メンションをやめる
        </Button>
      )}
    </div>
  );
}

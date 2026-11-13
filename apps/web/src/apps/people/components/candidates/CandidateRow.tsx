// 誘う候補の1行（名前・LINE名・最後に会った日・答えの印・進み具合・「文をコピー」。specs/people/001-people-memo contracts/ui-routes.md 1・3）。
// 文は buildInviteMessage で画面が作る（APIを呼ばない。research.md R17）。コピーのあと「興味を聞いたにする」で声かけを始める（1回のタップ）。
import { buildInviteMessage, OUTREACH_STAGES, type AnswerSummary, type CandidateItem, type OutreachPurpose, type OutreachStage, type PeopleEvent } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { peopleApi } from "../../lib/api";
import { personPath } from "../../lib/paths";
import { refreshOutreaches } from "../../lib/refresh";
import { OUTREACH_STAGE_LABELS } from "../person/labels";
import { lastMetLabel } from "../person/PersonRow";
import { copyText } from "./copy-text";

/**
 * 答えの印（次回参加・欲しいつながり・キャリアの興味）。
 * @param props - answers：いちばん新しい回答の答え
 * @returns 印の並び（答えがなければ何も出さない）
 */
function AnswerBadges({ answers }: { answers: AnswerSummary | null }) {
  if (!answers) return null;
  const badges = [
    ...(answers.nextAttendance ? [{ key: "next", label: `次回：${answers.nextAttendance}` }] : []),
    ...answers.wantedConnections.map((v) => ({ key: `wanted:${v}`, label: v })),
    ...answers.careerInterests.map((v) => ({ key: `career:${v}`, label: v })),
  ];
  if (badges.length === 0) return null;
  return (
    <ul aria-label="答え" className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <li key={b.key} className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs">
          {b.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * 進み具合のボタン（興味を聞いた・参加リンクを送った・来た）。今の段を濃く出し、押すとその段にする（戻すのは押し間違いを直すため）。
 * @param props - stage：今の段、pending：書いている途中、onChange：段を選んだとき、onRemove：記録を消す
 * @returns ボタンの並び
 */
function InviteStageButtons({
  stage,
  pending,
  onChange,
  onRemove,
}: {
  stage: OutreachStage;
  pending: boolean;
  onChange: (stage: OutreachStage) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="group" aria-label="進み具合" className="flex flex-wrap gap-1.5">
        {OUTREACH_STAGES.invite.map((s) => {
          const on = s === stage;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              disabled={pending}
              className={cn(
                "min-h-11 rounded-full border px-3 text-sm disabled:opacity-60 md:min-h-8",
                on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
              onClick={() => !on && onChange(s)}
            >
              {OUTREACH_STAGE_LABELS.invite[s]}
            </button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-11 rounded-full md:size-8" aria-label="声かけの記録を消す" disabled={pending} onClick={onRemove}>
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

/**
 * 交流会への誘いの操作（文をコピー・興味を聞いたにする・進み具合）。
 * @param props - person：候補、inviteEvent：誘う会（なければ null）、template：誘いの文の型（読み込み中は undefined）、onFallback：コピーできなかったときに文を渡す
 * @returns 操作
 */
function InviteActions({
  person,
  inviteEvent,
  template,
  onFallback,
}: {
  person: CandidateItem;
  inviteEvent: PeopleEvent | null;
  template: string | null | undefined;
  onFallback: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const outreach = person.outreach;
  const start = useMutation({
    mutationFn: (eventId: string) => peopleApi.createOutreach({ personId: person.id, eventId }),
    onSuccess: () => refreshOutreaches(queryClient),
  });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: OutreachStage }) => peopleApi.updateOutreach(id, stage),
    onSuccess: () => refreshOutreaches(queryClient),
  });
  const remove = useMutation({
    mutationFn: (id: string) => peopleApi.deleteOutreach(id),
    onSuccess: async () => {
      setCopied(false);
      await refreshOutreaches(queryClient);
    },
  });
  const failed = [start, move, remove].find((m) => m.isError);
  const pending = start.isPending || move.isPending || remove.isPending;

  const copy = async () => {
    if (!inviteEvent || template === undefined) return;
    const text = buildInviteMessage(template, { name: person.displayName, eventName: inviteEvent.name, heldOn: inviteEvent.heldOn });
    setCopied(true);
    if (await copyText(text)) toast.success("文をコピーしました");
    else onFallback(text);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full md:h-9"
          disabled={!inviteEvent || template === undefined}
          title={inviteEvent ? undefined : "誘う会を選んでください"}
          onClick={() => void copy()}
        >
          <CopyIcon /> 文をコピー
        </Button>
        {outreach === null && copied && inviteEvent && (
          <Button type="button" className="h-11 rounded-full md:h-9" disabled={pending} onClick={() => start.mutate(inviteEvent.id)}>
            興味を聞いたにする
          </Button>
        )}
      </div>
      {outreach !== null && (
        <InviteStageButtons
          stage={outreach.stage}
          pending={pending}
          onChange={(stage) => move.mutate({ id: outreach.id, stage })}
          onRemove={() => remove.mutate(outreach.id)}
        />
      )}
      {failed && (
        <p role="alert" className="text-[13px] text-destructive">
          {describeError(failed.error)}
        </p>
      )}
    </div>
  );
}

/**
 * 誘う候補の1行。
 * @param props - person：候補、purpose：目的、inviteEvent：誘う会、template：誘いの文の型、onFallback：コピーできなかったときに文を渡す
 * @returns 行
 */
export function CandidateRow({
  person,
  purpose,
  inviteEvent,
  template,
  onFallback,
}: {
  person: CandidateItem;
  purpose: OutreachPurpose;
  inviteEvent: PeopleEvent | null;
  template: string | null | undefined;
  onFallback: (text: string) => void;
}) {
  const showLine = person.lineName !== null && person.lineName !== person.displayName;
  return (
    <li className="space-y-2 px-4 py-3">
      <Link to={personPath(person.id)} className="-mx-2 block min-h-11 rounded-lg px-2 py-1 hover:bg-accent">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate font-medium">{person.displayName}</span>
          {showLine && <span className="truncate text-sm text-muted-foreground">LINE：{person.lineName}</span>}
        </div>
        <div className="text-sm text-muted-foreground">{lastMetLabel(person.lastMetOn)}</div>
      </Link>
      <AnswerBadges answers={person.latestAnswers} />
      {purpose === "invite" && <InviteActions person={person} inviteEvent={inviteEvent} template={template} onFallback={onFallback} />}
    </li>
  );
}

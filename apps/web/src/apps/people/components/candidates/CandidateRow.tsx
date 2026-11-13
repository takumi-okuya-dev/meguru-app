// 誘う候補の1行（名前・LINE名・最後に会った日・答えの印・進み具合・「文をコピー」。specs/people/001-people-memo contracts/ui-routes.md 1・3）。
// 文は buildInviteMessage で画面が作る（APIを呼ばない。research.md R17）。コピーのあと「興味を聞いたにする」で声かけを始める（1回のタップ）。
// 仕事の相談先へのつなぎでは「声かけを始める」（相談先の名前を入れる）と、本人に聞いた → OKをもらった → つないだ（FR-023・R16）。記録だけで、相手の情報はどこへも送らない。
import { countChars } from "@meguru/shared";
import {
  buildInviteMessage,
  OUTREACH_STAGES,
  PERSON_NAME_MAX,
  type AnswerSummary,
  type CandidateItem,
  type OutreachPurpose,
  type OutreachStage,
  type PeopleEvent,
} from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { peopleApi, type OutreachCreateInput } from "../../lib/api";
import { fieldClass } from "../EventForm";
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
 * 進み具合のボタン。今の段を濃く出し、押すとその段にする（戻すのは押し間違いを直すため）。
 * 仕事のつなぎでは、「OKをもらった」の前に「つないだ」を出さない（本人のOKのあとでつなぐ。FR-023）。
 * @param props - purpose：目的、stage：今の段、pending：書いている途中、onChange：段を選んだとき、onRemove：記録を消す
 * @returns ボタンの並び
 */
function StageButtons({
  purpose,
  stage,
  pending,
  onChange,
  onRemove,
}: {
  purpose: OutreachPurpose;
  stage: OutreachStage;
  pending: boolean;
  onChange: (stage: OutreachStage) => void;
  onRemove: () => void;
}) {
  const labels: Record<string, string> = OUTREACH_STAGE_LABELS[purpose];
  const stages: readonly OutreachStage[] =
    purpose === "work" && stage === "asked" ? OUTREACH_STAGES.work.filter((s) => s !== "connected") : OUTREACH_STAGES[purpose];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="group" aria-label="進み具合" className="flex flex-wrap gap-1.5">
        {stages.map((s) => {
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
              {labels[s]}
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
 * 1人の声かけの書き込み（始める・進める・消す）。出すエラーは最後の操作のものだけ。
 * @param options - locked：前の行を出したまま読み直している（押せなくする）、onStarted：始めたあと、onRemoved：消したあと
 * @returns 書き込みと、押せない・エラーの状態
 */
function useOutreachActions({ locked, onStarted, onRemoved }: { locked: boolean; onStarted?: () => void; onRemoved?: () => void }) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: (input: OutreachCreateInput) => peopleApi.createOutreach(input),
    onSuccess: async () => {
      await refreshOutreaches(queryClient);
      onStarted?.();
    },
  });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: OutreachStage }) => peopleApi.updateOutreach(id, stage),
    onSuccess: () => refreshOutreaches(queryClient),
  });
  const remove = useMutation({
    mutationFn: (id: string) => peopleApi.deleteOutreach(id),
    onSuccess: async () => {
      onRemoved?.();
      await refreshOutreaches(queryClient);
    },
  });
  const all = [start, move, remove];
  /**
   * 1つの操作を始める前に、ほかの操作の結果（古いエラー）を消す。
   * @param keep - これから始める操作
   */
  const clearOthers = (keep: { reset: () => void }) => {
    for (const m of all) if (m !== keep) m.reset();
  };
  return {
    pending: locked || all.some((m) => m.isPending),
    failed: all.find((m) => m.isError),
    begin: (input: OutreachCreateInput) => {
      clearOthers(start);
      start.mutate(input);
    },
    setStage: (id: string, stage: OutreachStage) => {
      clearOthers(move);
      move.mutate({ id, stage });
    },
    drop: (id: string) => {
      clearOthers(remove);
      remove.mutate(id);
    },
  };
}

/**
 * 操作のエラーの文言。
 * @param props - error：エラー（なければ何も出さない）
 * @returns 文言
 */
function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {describeError(error)}
    </p>
  );
}

/**
 * 交流会への誘いの操作（文をコピー・興味を聞いたにする・進み具合）。
 * @param props - person：候補、inviteEvent：誘う会（なければ null）、template：誘いの文の型（読み込み中は undefined、null は初めの型）、
 *   locked：前の行を出したまま読み直している（押せなくする）、onFallback：コピーできなかったときに文を渡す
 * @returns 操作
 */
function InviteActions({
  person,
  inviteEvent,
  template,
  locked,
  onFallback,
}: {
  person: CandidateItem;
  inviteEvent: PeopleEvent | null;
  template: string | null | undefined;
  locked: boolean;
  onFallback: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const outreach = person.outreach;
  const actions = useOutreachActions({ locked, onRemoved: () => setCopied(false) });

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
          disabled={locked || !inviteEvent || template === undefined}
          title={inviteEvent ? undefined : "誘う会を選んでください"}
          onClick={() => void copy()}
        >
          <CopyIcon /> 文をコピー
        </Button>
        {outreach === null && copied && inviteEvent && (
          <Button
            type="button"
            className="h-11 rounded-full md:h-9"
            disabled={actions.pending}
            onClick={() => actions.begin({ personId: person.id, purpose: "invite", eventId: inviteEvent.id })}
          >
            興味を聞いたにする
          </Button>
        )}
      </div>
      {outreach !== null && (
        <StageButtons
          purpose="invite"
          stage={outreach.stage}
          pending={actions.pending}
          onChange={(stage) => actions.setStage(outreach.id, stage)}
          onRemove={() => actions.drop(outreach.id)}
        />
      )}
      <ActionError error={actions.failed?.error} />
    </div>
  );
}

/**
 * 相談先の名前を入れて、仕事のつなぎの声かけを始める欄。
 * @param props - pending：書いている途中、onSubmit：始める（前後の空白を外した名前）、onCancel：やめる（省くと「やめる」を出さない）
 * @returns 欄
 */
function WorkTargetForm({ pending, onSubmit, onCancel }: { pending: boolean; onSubmit: (targetName: string) => void; onCancel?: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const tooLong = countChars(trimmed) > PERSON_NAME_MAX;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed === "" || tooLong) return;
    onSubmit(trimmed);
  };
  return (
    <form className="space-y-1" onSubmit={submit}>
      <label htmlFor={id} className="text-sm font-medium">
        相談先の名前
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          className={cn(fieldClass, "min-w-0 flex-1 basis-48")}
          value={name}
          autoComplete="off"
          aria-invalid={tooLong}
          placeholder="例：〇〇さん"
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" className="h-11 rounded-full md:h-9" disabled={pending || trimmed === "" || tooLong}>
          声かけを始める
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="h-11 rounded-full md:h-9" onClick={onCancel}>
            やめる
          </Button>
        )}
      </div>
      {tooLong && <p className="text-[13px] text-destructive">{PERSON_NAME_MAX}文字までにしてください。</p>}
    </form>
  );
}

/**
 * 仕事の相談先へのつなぎの操作（声かけを始める・進み具合・別の相談先を足す）。行には最新の声かけが出る。
 * @param props - person：候補、locked：前の行を出したまま読み直している（押せなくする）
 * @returns 操作
 */
function WorkActions({ person, locked }: { person: CandidateItem; locked: boolean }) {
  const outreach = person.outreach;
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState(false);
  const actions = useOutreachActions({
    locked,
    onStarted: () => {
      setAdding(false);
      setOpened(false);
    },
  });
  const begin = (targetName: string) => actions.begin({ personId: person.id, purpose: "work", targetName });

  return (
    <div className="space-y-2">
      {outreach === null ? (
        opened ? (
          <WorkTargetForm pending={actions.pending} onSubmit={begin} onCancel={() => setOpened(false)} />
        ) : (
          <Button type="button" variant="outline" className="h-11 rounded-full md:h-9" disabled={locked} onClick={() => setOpened(true)}>
            声かけを始める
          </Button>
        )
      ) : (
        <>
          <p className="text-sm">
            <span className="text-muted-foreground">相談先：</span>
            <span className="break-words">{outreach.targetName}</span>
          </p>
          <StageButtons
            purpose="work"
            stage={outreach.stage}
            pending={actions.pending}
            onChange={(stage) => actions.setStage(outreach.id, stage)}
            onRemove={() => actions.drop(outreach.id)}
          />
          {adding ? (
            <WorkTargetForm pending={actions.pending} onSubmit={begin} onCancel={() => setAdding(false)} />
          ) : (
            <Button type="button" variant="ghost" className="h-11 rounded-full px-3 md:h-9" disabled={locked} onClick={() => setAdding(true)}>
              <PlusIcon /> 別の相談先を足す
            </Button>
          )}
        </>
      )}
      <ActionError error={actions.failed?.error} />
    </div>
  );
}

/**
 * 誘う候補の1行。
 * @param props - person：候補、purpose：目的、inviteEvent：誘う会、template：誘いの文の型、locked：前の行を出したまま読み直している、
 *   onFallback：コピーできなかったときに文を渡す
 * @returns 行
 */
export function CandidateRow({
  person,
  purpose,
  inviteEvent,
  template,
  locked = false,
  onFallback,
}: {
  person: CandidateItem;
  purpose: OutreachPurpose;
  inviteEvent: PeopleEvent | null;
  template: string | null | undefined;
  locked?: boolean;
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
      {purpose === "invite" ? (
        <InviteActions person={person} inviteEvent={inviteEvent} template={template} locked={locked} onFallback={onFallback} />
      ) : (
        <WorkActions person={person} locked={locked} />
      )}
    </li>
  );
}

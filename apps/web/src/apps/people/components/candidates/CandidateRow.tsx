// 誘う候補の1行（名前・LINE名・最後に会った日・答えの印・進み具合・「文をコピー」。specs/people/001-people-memo contracts/ui-routes.md 1・3）。
// 文は buildInviteMessage で画面が作る（APIを呼ばない。research.md R17）。コピーのあと「興味を聞いたにする」で声かけを始める（1回のタップ）。
// 仕事の相談先へのつなぎでは「声かけを始める」（相談先の名前を入れる）と、本人に聞いた → OKをもらった → つないだ（FR-023・R16）。記録だけで、相手の情報はどこへも送らない。
import { countChars } from "@meguru/shared";
import {
  buildInviteMessage,
  PERSON_NAME_MAX,
  type AnswerSummary,
  type CandidateItem,
  type Outreach,
  type OutreachPurpose,
  type PeopleEvent,
} from "@meguru/shared/people";
import { CopyIcon, PlusIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "../EventForm";
import { personPath } from "../../lib/paths";
import { ActionError, OutreachStageButtons } from "../outreach/OutreachControls";
import { useOutreachActions } from "../outreach/use-outreach-actions";
import { PersonBadges } from "../person/PersonBadges";
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
        <OutreachStageButtons
          outreach={outreach}
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
 * 同じ相談先の声かけがもうあったときの文。行に出ている声かけとちがうものなら、どの相談先かも書く。
 * @param existing - 返ってきた（もうある）声かけ
 * @param shownId - 行に出ている声かけのID
 * @returns 文
 */
function alreadyRecordedNotice(existing: Outreach, shownId: string | undefined): string {
  if (existing.id === shownId) return "この相談先は、もう記録があります。";
  return `この相談先は、もう記録があります（相談先：${existing.targetName ?? ""}（もう記録あり））。進み具合は人のページで変えられます。`;
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
  const [notice, setNotice] = useState<string | null>(null);
  const actions = useOutreachActions({
    locked,
    onStarted: ({ outreach: result, created }) => {
      setAdding(false);
      setOpened(false);
      // 同じ相談先（nameKey が同じ）がもうあれば、黙らずに知らせる
      if (!created) setNotice(alreadyRecordedNotice(result, outreach?.id));
    },
  });
  const begin = (targetName: string) => {
    setNotice(null);
    actions.begin({ personId: person.id, purpose: "work", targetName });
  };

  return (
    <div className="space-y-2">
      {outreach === null ? (
        opened ? (
          <WorkTargetForm pending={actions.pending} onSubmit={begin} onCancel={() => setOpened(false)} />
        ) : (
          <Button type="button" variant="outline" className="h-11 rounded-full md:h-9" disabled={actions.pending} onClick={() => setOpened(true)}>
            声かけを始める
          </Button>
        )
      ) : (
        <>
          <p className="text-sm">
            <span className="text-muted-foreground">相談先：</span>
            <span className="break-words">{outreach.targetName}</span>
          </p>
          <OutreachStageButtons
            outreach={outreach}
            pending={actions.pending}
            onChange={(stage) => {
              setNotice(null);
              actions.setStage(outreach.id, stage);
            }}
            onRemove={() => {
              setNotice(null);
              actions.drop(outreach.id);
            }}
          />
          {adding ? (
            <WorkTargetForm pending={actions.pending} onSubmit={begin} onCancel={() => setAdding(false)} />
          ) : (
            <Button type="button" variant="ghost" className="h-11 rounded-full px-3 md:h-9" disabled={actions.pending} onClick={() => setAdding(true)}>
              <PlusIcon /> 別の相談先を足す
            </Button>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {notice}
        </p>
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
      <PersonBadges tags={person.tags} likelihood={person.likelihood} nextAction={person.nextAction} />
      <AnswerBadges answers={person.latestAnswers} />
      {purpose === "invite" ? (
        <InviteActions person={person} inviteEvent={inviteEvent} template={template} locked={locked} onFallback={onFallback} />
      ) : (
        <WorkActions person={person} locked={locked} />
      )}
    </li>
  );
}

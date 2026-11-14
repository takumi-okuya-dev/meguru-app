// 人のページの連絡の記録の段：いつ・何で（LINE・会場で・そのほか）・内容（specs/people/002-sales-list spec US3、FR-106）。
// 新しい順に並べ、足す・直す・消す。「やったこと」（次にやることを終えた記録）は、種類を直せない。
import { CONTACT_NOTE_MAX, jstDate, type ContactLog } from "@meguru/shared/people";
import { countChars } from "@meguru/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { fieldClass } from "../EventForm";
import { formatHeldOn } from "../format";
import { peopleApi, type ContactLogInput } from "../../lib/api";
import { refreshPersons } from "../../lib/refresh";
import { CONTACT_CHANNEL_LABELS } from "./labels";

/** 画面で選べる「何で」（やったことは次にやることを終えたときだけ作る）。 */
const CHANNELS: readonly ContactLogInput["channel"][] = ["line", "venue", "other"];

/**
 * 記録の欄（足す・直すで同じもの）。
 * @param props - initial：初めの値、doneKind：「やったこと」の記録（種類を直せない）、submitLabel：押すボタンの名前、pending：書いている途中、
 *   onSubmit：残す、onCancel：やめる（省くと出さない）
 * @returns 欄
 */
function ContactLogForm({
  initial,
  doneKind = false,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: ContactLogInput;
  doneKind?: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: ContactLogInput) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [on, setOn] = useState(initial.contactedOn);
  const [channel, setChannel] = useState(initial.channel);
  const [note, setNote] = useState(initial.note);
  const text = note.trim();
  const over = countChars(text) > CONTACT_NOTE_MAX;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text === "" || over || on === "") return;
    onSubmit({ contactedOn: on, channel, note: text });
  };
  return (
    <form className="space-y-2" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-on`} className="text-[13px] text-muted-foreground">
            いつ
          </label>
          <input id={`${id}-on`} type="date" required className={fieldClass} value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-channel`} className="text-[13px] text-muted-foreground">
            何で
          </label>
          {doneKind ? (
            <p id={`${id}-channel`} className="flex h-11 items-center text-sm md:h-10">
              {CONTACT_CHANNEL_LABELS.done}（直せません）
            </p>
          ) : (
            <select id={`${id}-channel`} className={fieldClass} value={channel} onChange={(e) => setChannel(e.target.value as ContactLogInput["channel"])}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CONTACT_CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <FieldWithCounter id={`${id}-note`} label="内容" value={note} onChange={setNote} max={CONTACT_NOTE_MAX} rows={3} placeholder="例：12月の会に興味あり。日程が決まったら連絡する" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 rounded-full md:h-9" disabled={pending || text === "" || over || on === ""}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="h-11 rounded-full md:h-9" onClick={onCancel}>
            やめる
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * 記録の1行（直す・消す）。
 * @param props - log：記録
 * @returns 行
 */
function ContactLogItem({ log }: { log: ContactLog }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const update = useMutation({
    mutationFn: (input: Partial<ContactLogInput>) => peopleApi.updateContactLog(log.id, input),
    onSuccess: async () => {
      setEditing(false);
      toast.success("記録を直しました");
      await refreshPersons(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: () => peopleApi.deleteContactLog(log.id),
    onSuccess: async () => {
      toast.success("記録を消しました");
      await refreshPersons(queryClient);
    },
  });
  const done = log.channel === "done";
  const error = update.error ?? remove.error;
  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      {editing ? (
        <ContactLogForm
          initial={{ contactedOn: log.contactedOn, channel: log.channel === "done" ? "other" : log.channel, note: log.note }}
          doneKind={done}
          submitLabel="直す"
          pending={update.isPending}
          // 「やったこと」は種類を送らない（直せない）
          onSubmit={({ channel, ...rest }) => update.mutate(done ? rest : { ...rest, channel })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
            <span>{formatHeldOn(log.contactedOn)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{CONTACT_CHANNEL_LABELS[log.channel]}</span>
          </div>
          <p className="break-words whitespace-pre-wrap">{log.note}</p>
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="ghost" className="h-11 rounded-full px-3 md:h-8" onClick={() => setEditing(true)}>
              直す
            </Button>
            {confirming ? (
              <>
                <Button type="button" variant="ghost" className="h-11 rounded-full px-3 text-destructive md:h-8" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  本当に消す
                </Button>
                <Button type="button" variant="ghost" className="h-11 rounded-full px-3 md:h-8" onClick={() => setConfirming(false)}>
                  やめる
                </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" className="h-11 rounded-full px-3 text-destructive md:h-8" onClick={() => setConfirming(true)}>
                消す
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {describeError(error)}
        </p>
      )}
    </li>
  );
}

/**
 * 連絡の記録の段。
 * @param props - personId：人、logs：記録（新しい順）
 * @returns 段
 */
export function PersonContactLogSection({ personId, logs }: { personId: string; logs: ContactLog[] }) {
  const id = useId();
  const queryClient = useQueryClient();
  // 足したら欄を空に戻す（作り直す）
  const [formKey, setFormKey] = useState(0);
  const add = useMutation({
    mutationFn: (input: ContactLogInput) => peopleApi.addContactLog(personId, input),
    onSuccess: async () => {
      setFormKey((k) => k + 1);
      toast.success("記録を足しました");
      await refreshPersons(queryClient);
    },
  });
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        連絡の記録
      </h2>
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <ContactLogForm key={formKey} initial={{ contactedOn: jstDate(new Date()), channel: "line", note: "" }} submitLabel="記録を足す" pending={add.isPending} onSubmit={(input) => add.mutate(input)} />
        {add.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {describeError(add.error)}
          </p>
        )}
      </div>
      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ記録はありません。</p>
      ) : (
        <ul aria-label="連絡の記録の一覧" className="divide-y rounded-2xl border bg-card">
          {logs.map((l) => (
            <ContactLogItem key={`${l.id}:${l.contactedOn}:${l.channel}:${l.note}`} log={l} />
          ))}
        </ul>
      )}
    </section>
  );
}

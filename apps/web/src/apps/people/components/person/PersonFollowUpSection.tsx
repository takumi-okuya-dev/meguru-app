// 人のページの「次にやること・来てくれそう度・誕生日」の段（specs/people/002-sales-list spec US2・US4、FR-104・FR-105・FR-107）。
// 次にやることは1つだけ（日付と文）。「終わった」で消し、連絡の記録に「やったこと」として残すかを選ぶ。誕生日は月日だけ（年は持たない）。
import { countChars } from "@meguru/shared";
import { isRealMonthDay, jstDate, NEXT_ACTION_MAX, type PersonSummary } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { fieldClass } from "../EventForm";
import { formatMonthDay } from "../format";
import { peopleApi, type PersonUpdateInput } from "../../lib/api";
import { refreshPersons } from "../../lib/refresh";
import { LIKELIHOOD_LABELS } from "./labels";
import { isOverdue, nextActionText } from "./PersonBadges";

/** 来てくれそう度のボタン（3＝高〜1＝低、null＝なし）。 */
const LIKELIHOOD_BUTTONS: readonly (number | null)[] = [3, 2, 1, null];

/**
 * 人を直して、人の並びを読み直す処理。
 * @param personId - 人
 * @param done - 直したあとに出す文
 * @returns ミューテーション
 */
function useUpdatePerson(personId: string, done: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonUpdateInput) => peopleApi.updatePerson(personId, input),
    onSuccess: async () => {
      toast.success(done);
      await refreshPersons(queryClient);
    },
  });
}

/**
 * 失敗の文言。
 * @param props - error：失敗（なければ出さない）
 * @returns 文言
 */
function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {describeError(error)}
    </p>
  );
}

/**
 * 次にやることの欄。
 * @param props - person：人
 * @returns 欄
 */
function NextActionPart({ person }: { person: PersonSummary }) {
  const id = useId();
  const queryClient = useQueryClient();
  const current = person.nextAction;
  const [on, setOn] = useState(current?.on ?? jstDate(new Date()));
  const [note, setNote] = useState(current?.note ?? "");
  const [finishing, setFinishing] = useState(false);
  const save = useUpdatePerson(person.id, "次にやることを保存しました");
  const clear = useUpdatePerson(person.id, "次にやることを消しました");
  const finish = useMutation({
    mutationFn: (log: boolean) => peopleApi.finishNextAction(person.id, log),
    onSuccess: async (_, log) => {
      setFinishing(false);
      setNote("");
      toast.success(log ? "終わりにして、連絡の記録に残しました" : "終わりにしました");
      await refreshPersons(queryClient);
    },
  });
  const text = note.trim();
  const tooLong = countChars(text) > NEXT_ACTION_MAX;
  const changed = current === null || current.on !== on || current.note !== text;
  const pending = save.isPending || clear.isPending || finish.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text === "" || tooLong || on === "") return;
    save.mutate({ nextActionOn: on, nextActionNote: text });
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">次にやること</h3>
      {current && (
        <p className={cn("text-sm break-words", isOverdue(current) && "font-medium text-destructive")}>
          {nextActionText(current)}
          {isOverdue(current) && "（過ぎています）"}
        </p>
      )}
      <form className="space-y-2" onSubmit={submit}>
        <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-2 max-sm:grid-cols-1">
          <div className="min-w-0 space-y-1">
            <label htmlFor={`${id}-on`} className="text-[13px] text-muted-foreground">
              いつ
            </label>
            <input id={`${id}-on`} type="date" required className={fieldClass} value={on} onChange={(e) => setOn(e.target.value)} />
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor={`${id}-note`} className="text-[13px] text-muted-foreground">
              何をするか
            </label>
            <input
              id={`${id}-note`}
              className={fieldClass}
              value={note}
              autoComplete="off"
              placeholder="例：12月の会の案内を送る"
              aria-invalid={tooLong}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        {tooLong && <p className="text-[13px] text-destructive">{NEXT_ACTION_MAX}文字までにしてください。</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-11 rounded-full md:h-9" disabled={pending || text === "" || tooLong || on === "" || !changed}>
            次にやることを保存
          </Button>
          {current && !finishing && (
            <>
              <Button type="button" variant="outline" className="h-11 rounded-full md:h-9" disabled={pending} onClick={() => setFinishing(true)}>
                終わった
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-full md:h-9"
                disabled={pending}
                onClick={() => clear.mutate({ nextActionOn: null, nextActionNote: null }, { onSuccess: () => setNote("") })}
              >
                消す
              </Button>
            </>
          )}
        </div>
      </form>
      {current && finishing && (
        <div role="group" aria-label="終わったときの記録" className="space-y-2 rounded-xl bg-muted p-3">
          <p className="text-sm">連絡の記録に「やったこと」として残しますか？</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-11 rounded-full md:h-9" disabled={pending} onClick={() => finish.mutate(true)}>
              記録に残して終える
            </Button>
            <Button type="button" variant="outline" className="h-11 rounded-full md:h-9" disabled={pending} onClick={() => finish.mutate(false)}>
              残さずに終える
            </Button>
            <Button type="button" variant="ghost" className="h-11 rounded-full md:h-9" disabled={pending} onClick={() => setFinishing(false)}>
              やめる
            </Button>
          </div>
        </div>
      )}
      <ErrorLine error={save.error ?? clear.error ?? finish.error} />
    </div>
  );
}

/**
 * 来てくれそう度の欄（押すとすぐ残す）。
 * @param props - person：人
 * @returns 欄
 */
function LikelihoodPart({ person }: { person: PersonSummary }) {
  const save = useUpdatePerson(person.id, "来てくれそう度を保存しました");
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">来てくれそう度</h3>
      <div role="group" aria-label="来てくれそう度" className="flex flex-wrap gap-1.5">
        {LIKELIHOOD_BUTTONS.map((v) => {
          const on = person.likelihood === v;
          return (
            <button
              key={String(v)}
              type="button"
              aria-pressed={on}
              disabled={save.isPending}
              className={cn(
                "min-h-11 min-w-14 rounded-full border px-3 text-sm disabled:opacity-60 md:min-h-8",
                on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
              onClick={() => !on && save.mutate({ likelihood: v })}
            >
              {v === null ? "なし" : LIKELIHOOD_LABELS[v]}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-muted-foreground">あなたの見立てです。アンケートの「次回参加」の答えとは別に持ちます。</p>
      <ErrorLine error={save.error} />
    </div>
  );
}

/**
 * 誕生日の欄（月日だけ。ない日は選べない）。
 * @param props - person：人
 * @returns 欄
 */
function BirthdayPart({ person }: { person: PersonSummary }) {
  const id = useId();
  const [m0, d0] = person.birthdayMd?.split("-") ?? ["", ""];
  const [month, setMonth] = useState(m0 ?? "");
  const [day, setDay] = useState(d0 ?? "");
  const save = useUpdatePerson(person.id, "誕生日を保存しました");
  const md = month !== "" && day !== "" ? `${month}-${day}` : "";
  const valid = md !== "" && isRealMonthDay(md);
  // 月を変えて、その月にない日（2月30日など）になったら日を選び直す
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).filter((d) => month === "" || isRealMonthDay(`${month}-${d}`));
  const changeMonth = (m: string) => {
    setMonth(m);
    if (m !== "" && day !== "" && !isRealMonthDay(`${m}-${day}`)) setDay("");
  };
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">誕生日</h3>
      {person.birthdayMd && <p className="text-sm">{formatMonthDay(person.birthdayMd)}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-m`} className="text-[13px] text-muted-foreground">
            月
          </label>
          <select id={`${id}-m`} className={cn(fieldClass, "w-24")} value={month} onChange={(e) => changeMonth(e.target.value)}>
            <option value="">―</option>
            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
              <option key={m} value={m}>
                {Number(m)}月
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-d`} className="text-[13px] text-muted-foreground">
            日
          </label>
          <select id={`${id}-d`} className={cn(fieldClass, "w-24")} value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">―</option>
            {days.map((d) => (
              <option key={d} value={d}>
                {Number(d)}日
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          className="h-11 rounded-full md:h-10"
          disabled={save.isPending || !valid || md === person.birthdayMd}
          onClick={() => save.mutate({ birthdayMd: md })}
        >
          誕生日を保存
        </Button>
        {person.birthdayMd && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-full md:h-10"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { birthdayMd: null },
                {
                  onSuccess: () => {
                    setMonth("");
                    setDay("");
                  },
                },
              )
            }
          >
            消す
          </Button>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">年は持ちません。近い誕生日（7日以内）は、ホームに出ます。</p>
      <ErrorLine error={save.error} />
    </div>
  );
}

/**
 * 次にやること・来てくれそう度・誕生日の段。人が変わったら呼ぶ側が key を変えて作り直す。
 * @param props - person：人
 * @returns 段
 */
export function PersonFollowUpSection({ person }: { person: PersonSummary }) {
  const id = useId();
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        声かけの予定
      </h2>
      <div className="space-y-5 rounded-2xl border bg-card p-4">
        <NextActionPart key={`${person.nextAction?.on ?? ""}:${person.nextAction?.note ?? ""}`} person={person} />
        <LikelihoodPart person={person} />
        <BirthdayPart key={person.birthdayMd ?? ""} person={person} />
      </div>
    </section>
  );
}

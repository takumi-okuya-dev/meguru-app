// 人のページの名前の段：本名（直す）・LINE名・別名・最後に会った日（specs/people/001-people-memo contracts/ui-routes.md 1、research.md R10）。
import { PERSON_NAME_MAX, type PersonSummary } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { peopleApi } from "../../lib/api";
import { refreshPersons } from "../../lib/refresh";
import { fieldClass } from "../EventForm";
import { formatHeldOn } from "../format";

/**
 * 本名を直す欄。
 * @param props - person：人、onDone：終わったとき（保存・やめる）
 * @returns 入力欄
 */
function RealNameForm({ person, onDone }: { person: PersonSummary; onDone: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(person.realName ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (realName: string | null) => peopleApi.updatePerson(person.id, { realName }),
    onSuccess: async () => {
      toast.success("本名を保存しました");
      onDone();
      await refreshPersons(queryClient, { names: true });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    // LINE名のない人は、本名を消すと名前がなくなる（APIも400にする）
    if (trimmed === "" && person.lineName === null) {
      setError("LINE名がないので、本名は消せません");
      return;
    }
    save.mutate(trimmed === "" ? null : trimmed);
  };
  return (
    <form className="space-y-2" onSubmit={submit} noValidate>
      <label htmlFor={id} className="text-sm font-medium">
        本名
      </label>
      <input
        id={id}
        className={fieldClass}
        value={value}
        maxLength={PERSON_NAME_MAX}
        placeholder="例：山田 花子"
        aria-invalid={error !== null}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      {person.lineName !== null && <p className="text-[13px] text-muted-foreground">空にして保存すると、本名を消します。</p>}
      {(error ?? (save.isError ? describeError(save.error) : null)) && (
        <p role="alert" className="text-[13px] text-destructive">
          {error ?? describeError(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-full md:h-9" onClick={onDone}>
          やめる
        </Button>
        <Button type="submit" className="h-11 rounded-full md:h-9" disabled={save.isPending}>
          保存
        </Button>
      </div>
    </form>
  );
}

/**
 * 名前の段。
 * @param props - person：人
 * @returns 名前の段
 */
export function PersonNameSection({ person }: { person: PersonSummary }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="person-name-heading">
      <h2 id="person-name-heading" className="sr-only">
        名前
      </h2>
      {editing ? (
        <RealNameForm person={person} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">本名</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 break-words">{person.realName ?? <span className="text-muted-foreground">なし</span>}</span>
            <Button variant="ghost" size="icon" className="size-11 shrink-0 md:size-9" aria-label="本名を直す" onClick={() => setEditing(true)}>
              <PencilIcon className="size-4" />
            </Button>
          </dd>
          <dt className="text-muted-foreground">LINE名</dt>
          <dd className="break-words">{person.lineName ?? <span className="text-muted-foreground">なし</span>}</dd>
          {person.otherLineNames.length > 0 && (
            <>
              <dt className="text-muted-foreground">別名</dt>
              <dd className="break-words">{person.otherLineNames.join("、")}</dd>
            </>
          )}
          <dt className="text-muted-foreground">最後に会った日</dt>
          <dd>{person.lastMetOn ? formatHeldOn(person.lastMetOn) : <span className="text-muted-foreground">まだ会ったイベントがありません</span>}</dd>
        </dl>
      )}
    </section>
  );
}

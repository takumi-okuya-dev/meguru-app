// 「/people/list/new」：人を手で足す（specs/people/001-people-memo contracts/ui-routes.md 1、FR-014、US2）。
// 本名・LINE名（どちらかは必須）・会ったイベント（選ばなくてもよい）・同意2つ（初めは同意なし）。足したら人のページへ移る。
import { PERSON_NAME_MAX } from "@meguru/shared/people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { PageBody, PageHeader } from "@/shell";
import { fieldClass } from "../components/EventForm";
import { formatHeldOn } from "../components/format";
import { CONSENT_KEYS, CONSENT_LABELS } from "../components/person/labels";
import { peopleApi, type PersonCreateInput } from "../lib/api";
import { personPath, personsPath } from "../lib/paths";
import { peopleQueryKeys } from "../lib/query-keys";
import { refreshAllPeople } from "../lib/refresh";

/**
 * 人を手で足す画面。
 * @returns 画面
 */
export function PersonNewPage() {
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const events = useQuery({ queryKey: peopleQueryKeys.events, queryFn: peopleApi.events });
  const [realName, setRealName] = useState("");
  const [lineName, setLineName] = useState("");
  const [eventId, setEventId] = useState("");
  const [consent, setConsent] = useState({ invite: false, work: false });
  const [nameError, setNameError] = useState(false);
  const create = useMutation({
    mutationFn: (input: PersonCreateInput) => peopleApi.createPerson(input),
    onSuccess: async (person) => {
      void navigate(personPath(person.id));
      await refreshAllPeople(queryClient);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const real = realName.trim();
    const line = lineName.trim();
    if (real === "" && line === "") {
      setNameError(true);
      return;
    }
    create.mutate({
      ...(real !== "" ? { realName: real } : {}),
      ...(line !== "" ? { lineName: line } : {}),
      ...(eventId !== "" ? { eventId } : {}),
      consent,
    });
  };
  const clearNameError = () => setNameError(false);

  return (
    <>
      <PageHeader title="人を足す" />
      <PageBody>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <p className="text-sm text-muted-foreground">本名かLINE名の、どちらかは入れてください。</p>
          <div className="space-y-1">
            <label htmlFor={`${id}-real`} className="text-sm font-medium">
              本名
            </label>
            <input
              id={`${id}-real`}
              className={fieldClass}
              value={realName}
              maxLength={PERSON_NAME_MAX * 2}
              placeholder="例：山田 花子"
              autoComplete="off"
              aria-invalid={nameError}
              onChange={(e) => {
                setRealName(e.target.value);
                clearNameError();
              }}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-line`} className="text-sm font-medium">
              LINE名
            </label>
            <input
              id={`${id}-line`}
              className={fieldClass}
              value={lineName}
              maxLength={PERSON_NAME_MAX * 2}
              placeholder="例：はなこ"
              autoComplete="off"
              aria-invalid={nameError}
              onChange={(e) => {
                setLineName(e.target.value);
                clearNameError();
              }}
            />
          </div>
          {nameError && (
            <p role="alert" className="text-[13px] text-destructive">
              本名かLINE名を入れてください
            </p>
          )}
          <div className="space-y-1">
            <label htmlFor={`${id}-event`} className="text-sm font-medium">
              会ったイベント
            </label>
            <select id={`${id}-event`} className={fieldClass} value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">選ばない</option>
              {(events.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {formatHeldOn(e.heldOn)} {e.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">個別の案内の同意</legend>
            <p className="text-[13px] text-muted-foreground">本人から同意をもらった目的だけ選んでください。</p>
            {CONSENT_KEYS.map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" className="size-5" checked={consent[k]} onChange={(e) => setConsent({ ...consent, [k]: e.target.checked })} />
                {CONSENT_LABELS[k]}に同意
              </label>
            ))}
          </fieldset>
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {describeError(create.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11 rounded-full md:h-10" onClick={() => void navigate(personsPath())}>
              キャンセル
            </Button>
            <Button type="submit" className="h-11 rounded-full md:h-10" disabled={create.isPending}>
              足す
            </Button>
          </div>
        </form>
      </PageBody>
    </>
  );
}

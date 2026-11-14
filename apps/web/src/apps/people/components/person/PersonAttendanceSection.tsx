// 人のページの来たイベントの段（新しい順。イベントごとのアンケートの答え）。specs/people/001-people-memo contracts/ui-routes.md 1、FR-025。
// 回答ごとの「別の人に分ける」（research.md R15）・会ったイベントを足す・手で足した会ったイベントを外す（FR-014）。
import type { PersonAttendance, PersonResponse } from "@meguru/shared/people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { describeError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { peopleApi } from "../../lib/api";
import { eventPath, newEventPath, personPath } from "../../lib/paths";
import { peopleQueryKeys } from "../../lib/query-keys";
import { refreshAllPeople } from "../../lib/refresh";
import { fieldClass } from "../EventForm";
import { formatHeldOn } from "../format";

/**
 * 1つの回答（答えの一覧と「別の人に分ける」）。
 * @param props - response：回答、onSplit：「別の人に分ける」を押したとき（分けられないときは省く）
 * @returns 回答
 */
function ResponseCard({ response, onSplit }: { response: PersonResponse; onSplit?: () => void }) {
  const answers = response.answers.filter((a) => a.a.trim() !== "");
  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 text-muted-foreground">
          回答 {response.submittedAt ? formatDateTime(response.submittedAt) : "（時刻なし）"}・LINE名「{response.lineName}」
        </span>
        {onSplit && (
          <Button variant="outline" size="sm" className="h-11 rounded-full md:h-8" onClick={onSplit}>
            別の人に分ける
          </Button>
        )}
      </div>
      {answers.length > 0 && (
        <dl className="space-y-1.5">
          {answers.map((a, i) => (
            <div key={i}>
              <dt className="text-[13px] text-muted-foreground">{a.q}</dt>
              <dd className="break-words whitespace-pre-wrap">{a.a}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * 会ったイベントを足すダイアログ（作り手のイベントから選ぶ）。
 * @param props - personId：人、attendedIds：もう来たイベント、onClose：閉じる
 * @returns ダイアログ
 */
function AddAttendanceDialog({ personId, attendedIds, onClose }: { personId: string; attendedIds: Set<string>; onClose: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const events = useQuery({ queryKey: peopleQueryKeys.events, queryFn: peopleApi.events });
  const choices = (events.data ?? []).filter((e) => !attendedIds.has(e.id));
  const [eventId, setEventId] = useState("");
  const add = useMutation({
    mutationFn: () => peopleApi.addAttendance(personId, eventId),
    onSuccess: async () => {
      toast.success("会ったイベントを足しました");
      onClose();
      await refreshAllPeople(queryClient);
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogTitle>会ったイベントを足す</DialogTitle>
        {events.isPending ? (
          <p className="text-sm text-muted-foreground">読み込んでいます…</p>
        ) : events.isError ? (
          <p className="text-sm text-destructive">{describeError(events.error)}</p>
        ) : choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            足せるイベントがありません。<Link to={newEventPath()} className="underline">イベントを作る</Link>
          </p>
        ) : (
          <div className="space-y-1">
            <label htmlFor={id} className="text-sm font-medium">
              イベント
            </label>
            <select id={id} className={fieldClass} value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">選んでください</option>
              {choices.map((e) => (
                <option key={e.id} value={e.id}>
                  {formatHeldOn(e.heldOn)} {e.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {add.isError && (
          <p role="alert" className="text-sm text-destructive">
            {describeError(add.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-11 rounded-full md:h-10" onClick={onClose}>
            キャンセル
          </Button>
          <Button className="h-11 rounded-full md:h-10" disabled={eventId === "" || add.isPending} onClick={() => add.mutate()}>
            足す
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 確かめている操作。 */
type Pending = { kind: "split"; response: PersonResponse; eventName: string } | { kind: "remove"; attendance: PersonAttendance };

/**
 * 来たイベントの段。
 * @param props - personId：人、attendances：来たイベント（新しい順）
 * @returns 来たイベントの段
 */
export function PersonAttendanceSection({ personId, attendances }: { personId: string; attendances: PersonAttendance[] }) {
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // 回答が1つしかない人は分けられない（APIも400にする。R15）
  const canSplit = attendances.reduce((n, a) => n + a.responses.length, 0) >= 2;

  const split = useMutation({
    mutationFn: (responseId: string) => peopleApi.splitResponse(responseId),
    onSuccess: async (fresh) => {
      setPending(null);
      toast.success("回答を別の人に分けました");
      void navigate(personPath(fresh.id));
      await refreshAllPeople(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: (eventId: string) => peopleApi.removeAttendance(personId, eventId),
    onSuccess: async () => {
      setPending(null);
      toast.success("会ったイベントを外しました");
      await refreshAllPeople(queryClient);
    },
  });

  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
          来たイベント
        </h2>
        <Button variant="outline" size="sm" className="h-11 rounded-full md:h-8" onClick={() => setAdding(true)}>
          <PlusIcon /> 会ったイベントを足す
        </Button>
      </div>
      {attendances.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ会ったイベントがありません。</p>
      ) : (
        <ul className="space-y-3">
          {attendances.map((a) => (
            <li key={a.event.id} className="space-y-2 rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="min-w-0 flex-1">
                  <Link to={eventPath(a.event.id)} className="inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline md:min-h-0">
                    {a.event.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{formatHeldOn(a.event.heldOn)}</span>
                    {a.event.isOwn && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">自分の会</span>}
                    {a.via === "manual" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">手で足した</span>}
                  </div>
                </div>
                {a.via === "manual" && (
                  <Button variant="ghost" size="sm" className="h-11 rounded-full md:h-8" onClick={() => setPending({ kind: "remove", attendance: a })}>
                    外す
                  </Button>
                )}
              </div>
              {a.responses.map((r) => (
                <ResponseCard
                  key={r.id}
                  response={r}
                  onSplit={canSplit ? () => setPending({ kind: "split", response: r, eventName: a.event.name }) : undefined}
                />
              ))}
            </li>
          ))}
        </ul>
      )}

      {adding && <AddAttendanceDialog personId={personId} attendedIds={new Set(attendances.map((a) => a.event.id))} onClose={() => setAdding(false)} />}
      {pending?.kind === "split" && (
        <ConfirmDialog
          title="この回答を別の人に分けますか？"
          confirmLabel="分ける"
          pending={split.isPending}
          error={split.isError ? describeError(split.error) : null}
          onConfirm={() => split.mutate(pending.response.id)}
          onCancel={() => {
            setPending(null);
            split.reset();
          }}
        >
          <p>
            「{pending.eventName}」の回答（LINE名「{pending.response.lineName}」）で新しい人を作り、この回答を移します。
          </p>
          <p>メモと、手で直した同意は、この人に残ります。分けたあとは、新しい人のページを開きます。</p>
        </ConfirmDialog>
      )}
      {pending?.kind === "remove" && (
        <ConfirmDialog
          title="この会ったイベントを外しますか？"
          confirmLabel="外す"
          destructive
          pending={remove.isPending}
          error={remove.isError ? describeError(remove.error) : null}
          onConfirm={() => remove.mutate(pending.attendance.event.id)}
          onCancel={() => {
            setPending(null);
            remove.reset();
          }}
        >
          <p>
            「{pending.attendance.event.name}」（{formatHeldOn(pending.attendance.event.heldOn)}）を、この人の会ったイベントから外します。
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

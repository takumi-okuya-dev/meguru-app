// 取り込みの②どのイベントか（選ぶ・作る。specs/people/001-people-memo contracts/ui-routes.md 2、FR-002）。
// 作るときもこの画面の中で作る（ほかの画面へ移ると、読んだ行を捨てるため）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { EventForm, fieldClass } from "../EventForm";
import { formatHeldOn } from "../format";
import { peopleApi } from "../../lib/api";
import { peopleQueryKeys } from "../../lib/query-keys";
import { refreshEvents } from "../../lib/refresh";

/**
 * イベントを選ぶ段。
 * @param props - eventId：選んだイベント、onSelect：選んだとき、pending：次へ進む処理の途中、error：失敗の文言、onBack：戻る、onNext：次へ
 * @returns イベントを選ぶ段
 */
export function EventStep({
  eventId,
  onSelect,
  pending,
  error,
  onBack,
  onNext,
}: {
  eventId: string | null;
  onSelect: (id: string) => void;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const events = useQuery({ queryKey: peopleQueryKeys.events, queryFn: peopleApi.events });
  const [creating, setCreating] = useState(false);
  const create = useMutation({
    mutationFn: peopleApi.createEvent,
    onSuccess: async (event) => {
      await refreshEvents(queryClient);
      onSelect(event.id);
      setCreating(false);
    },
  });
  const list = [...(events.data ?? [])].sort((a, b) => (a.heldOn < b.heldOn ? 1 : a.heldOn > b.heldOn ? -1 : 0));
  // 作ったばかりのイベントが一覧の読み直しの前でも選べるよう、作った結果も並べる
  const created = create.data && !list.some((e) => e.id === create.data.id) ? [create.data] : [];
  return (
    <div className="space-y-4">
      {creating ? (
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          <h3 className="text-sm font-medium">新しいイベントを作る</h3>
          <EventForm
            submitLabel="作る"
            pending={create.isPending}
            error={create.isError ? describeError(create.error) : null}
            onSubmit={(input) => create.mutate(input)}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <label htmlFor={id} className="text-sm font-medium">
              どのイベントのアンケートですか
            </label>
            {events.isError ? (
              <p className="text-sm text-destructive">{describeError(events.error)}</p>
            ) : (
              <select id={id} className={fieldClass} value={eventId ?? ""} disabled={events.isPending} onChange={(e) => e.target.value && onSelect(e.target.value)}>
                <option value="">{events.isPending ? "読み込んでいます…" : "選んでください"}</option>
                {[...created, ...list].map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}（{formatHeldOn(e.heldOn)}）
                  </option>
                ))}
              </select>
            )}
          </div>
          <Button variant="outline" className="h-11 rounded-full md:h-9" onClick={() => setCreating(true)}>
            <PlusIcon /> 新しいイベントを作る
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <Button variant="outline" className="h-11 rounded-full md:h-10" onClick={onBack}>
          戻る
        </Button>
        <Button className="h-11 rounded-full md:h-10" disabled={!eventId || creating || pending} onClick={onNext}>
          次へ
        </Button>
      </div>
    </div>
  );
}

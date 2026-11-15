// イベントを作る入力欄（specs/people/003-threads-event-candidates plan.md R3）。Threads のイベントの候補から選ぶ欄と、
// 名前・開催日・自分の会かの入力欄。候補を選ぶと名前と開催日が入り、作るときに元の宣伝内容の番号を送る。
// 「イベントを作る」の画面と、取り込みの「新しいイベントを作る」で使う。
import type { PeopleThreadsCandidate } from "@meguru/shared/people";
import { useState } from "react";
import type { EventCreateInput } from "../lib/api";
import { EventForm } from "./EventForm";
import { ThreadsEventPicker, candidateHeldOn } from "./ThreadsEventPicker";

/**
 * イベントを作る入力欄。
 * @param props - pending：処理中、error：失敗の文言、onSubmit：作るとき、onCancel：やめる
 * @returns 入力欄
 */
export function EventCreateForm({
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  error: string | null;
  onSubmit: (input: EventCreateInput) => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<PeopleThreadsCandidate | null>(null);
  return (
    <div className="space-y-5">
      <ThreadsEventPicker selectedId={source?.promotionId ?? null} onSelect={setSource} />
      {/* 候補を選び直すたびに入力欄を作り直し、名前と開催日を入れ直す */}
      <EventForm
        key={source?.promotionId ?? "manual"}
        initial={source ? { name: source.name, heldOn: candidateHeldOn(source), isOwn: true } : undefined}
        submitLabel="作る"
        pending={pending}
        error={error}
        onSubmit={(input) => onSubmit(source ? { ...input, sourceThreadsPromotionId: source.promotionId } : input)}
        onCancel={onCancel}
      />
    </div>
  );
}

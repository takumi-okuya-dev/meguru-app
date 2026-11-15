// イベントを作る（/collect/events/new。specs/collect/001-event-day-collection FR-010・FR-062、tasks.md T029・T078）。
// Threads の宣伝内容にイベントの情報があれば「Threadsのイベントから選ぶ」を出す。選ぶと名前・日時・会場・定員と、参加費を
// 料金の区分の下書きに入れる（保存するまではできない）。作ったら名簿へ移る。候補がなければ、この欄は出さない。
import { COLLECT_MEDIA_LABELS, type ThreadsCandidate } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatJstWithWeekday } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { EventForm } from "../components/EventForm";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { rosterPath, selfCheckInPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/**
 * Threads のイベントから選ぶ欄（候補がなければ何も出さない）。
 * @param props - picked：選んでいる候補、onPick：選ぶ・外す
 * @returns 欄
 */
function ThreadsPicker({ picked, onPick }: { picked: ThreadsCandidate | null; onPick: (c: ThreadsCandidate | null) => void }) {
  const candidates = useQuery({ queryKey: collectQueryKeys.threadsCandidates, queryFn: collectApi.threadsCandidates });
  const list = candidates.data?.candidates ?? [];
  if (list.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="threads-title">
      <h2 id="threads-title" className="font-medium">
        Threadsのイベントから選ぶ
      </h2>
      <p className="text-sm text-muted-foreground">めぐる Threads の宣伝内容に入れたイベントの情報から、入力欄を埋められます（保存するまではイベントはできません）。</p>
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.promotionId} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center" aria-label={c.name}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">
                {formatJstWithWeekday(c.startsAt)}
                {c.venue && `・${c.venue}`}
                {c.feeAmount !== null && `・${yen(c.feeAmount)}`}
                {c.postedMedia.length > 0 && `・掲載済み：${c.postedMedia.map((m) => COLLECT_MEDIA_LABELS[m]).join("・")}`}
              </div>
            </div>
            {c.usedByEventId ? (
              <Button asChild variant="ghost" size="sm">
                <Link to={rosterPath(c.usedByEventId)}>作ったイベントを開く</Link>
              </Button>
            ) : picked?.promotionId === c.promotionId ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onPick(null)}>
                選ぶのをやめる
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => onPick(c)}>
                これで作る
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * イベントを作る画面。
 * @returns 画面
 */
export function EventNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<ThreadsCandidate | null>(null);
  const create = useMutation({
    mutationFn: collectApi.createEvent,
    onSuccess: (event) => {
      queryClient.setQueryData(collectQueryKeys.event(event.id), event);
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.events });
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.threadsCandidates });
      // 名簿なしなら、すぐセルフ受付のQRを出せるようにセルフ受付の画面へ（specs/collect/004 FR-003）
      if (event.checkInMode === "rosterless") {
        toast.success("イベントを作りました。セルフ受付のQRを出しましょう。");
        navigate(selfCheckInPath(event.id));
      } else {
        toast.success("イベントを作りました。名簿を入れましょう。");
        navigate(rosterPath(event.id));
      }
    },
    onError: (err) => toast.error(collectErrorText(err)),
  });
  return (
    <>
      <PageHeader title="イベントを作る" />
      <PageBody className="space-y-8">
        <ThreadsPicker picked={picked} onPick={setPicked} />
        {picked && (
          <p role="status" className="text-sm">
            「{picked.name}」の情報を入れました。{picked.feeNote && `参加費のメモ：${picked.feeNote}`}
          </p>
        )}
        {/* 選んだ候補が変わったら入力欄を作り直す */}
        <EventForm
          key={picked?.promotionId ?? "blank"}
          draft={picked ?? undefined}
          submitLabel="作る"
          pending={create.isPending}
          onSubmit={(input) => create.mutate({ ...input, sourceThreadsPromotionId: picked?.promotionId ?? null })}
        />
      </PageBody>
    </>
  );
}

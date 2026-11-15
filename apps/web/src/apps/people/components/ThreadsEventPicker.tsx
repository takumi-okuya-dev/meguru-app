// Threads のイベントの候補から選ぶ欄（specs/people/003-threads-event-candidates plan.md R3、FR-008）。
// 「イベントを作る」と取り込みの「新しいイベントを作る」で、入力欄の上に置く。選ぶと、親が名前と開催日を入力欄に入れる。
// 読み込みに失敗したときは何も出さない（手でイベントを作れるままにする）。
import { jstDate, type PeopleThreadsCandidate } from "@meguru/shared/people";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { peopleApi } from "../lib/api";
import { peopleQueryKeys } from "../lib/query-keys";
import { formatHeldOn } from "./format";

/**
 * 候補の開催日（開始の時刻の日本時間の日付。「YYYY-MM-DD」）。
 * @param candidate - 候補
 * @returns 開催日
 */
export function candidateHeldOn(candidate: PeopleThreadsCandidate): string {
  return jstDate(new Date(candidate.startsAt));
}

/**
 * Threads のイベントの候補から選ぶ欄。
 * @param props - selectedId：選んでいる候補の番号、onSelect：選んだ・やめたとき（やめたら null）
 * @returns 選ぶ欄（読み込み中・失敗のときは何も出さない）
 */
export function ThreadsEventPicker({ selectedId, onSelect }: { selectedId: string | null; onSelect: (candidate: PeopleThreadsCandidate | null) => void }) {
  const headingId = useId();
  const candidates = useQuery({ queryKey: peopleQueryKeys.threadsCandidates, queryFn: peopleApi.threadsCandidates });
  if (!candidates.data) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium">
          Threadsのイベントから作る
        </h3>
        {selectedId && (
          <Button type="button" variant="ghost" className="h-11 rounded-full px-3 text-sm md:h-8" onClick={() => onSelect(null)}>
            選ぶのをやめる
          </Button>
        )}
      </div>
      {candidates.data.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">めぐる Threads の宣伝内容に開催日時を入れて保存すると、ここに出ます。</p>
      ) : (
        <ul className="space-y-2">
          {candidates.data.map((c) => {
            const used = c.usedByEventId !== null;
            const selected = c.promotionId === selectedId;
            return (
              <li key={c.promotionId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={used}
                  onClick={() => onSelect(c)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 text-left text-sm",
                    selected && "border-foreground",
                    used ? "text-muted-foreground" : "hover:bg-accent",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-[13px] text-muted-foreground">{formatHeldOn(candidateHeldOn(c))}</span>
                  </span>
                  {used ? (
                    <span className="shrink-0 text-[13px]">作った</span>
                  ) : (
                    selected && <CheckIcon aria-hidden className="size-5 shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// 「/people/events」：イベントの一覧（specs/people/001-people-memo contracts/ui-routes.md 1）。開催日の新しい順・自分の会の印・参加者数。
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { Link } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/shell";
import { formatHeldOn } from "../components/format";
import { peopleApi } from "../lib/api";
import { eventPath, newEventPath } from "../lib/paths";
import { peopleQueryKeys } from "../lib/query-keys";

/**
 * イベントの一覧の画面。
 * @returns 画面
 */
export function EventsPage() {
  const events = useQuery({ queryKey: peopleQueryKeys.events, queryFn: peopleApi.events });
  const create = (
    <Button asChild size="sm" className="h-11 rounded-full md:h-9">
      <Link to={newEventPath()}>
        <PlusIcon /> イベントを作る
      </Link>
    </Button>
  );
  if (events.isPending) return <LoadingSkeleton />;
  if (events.isError) return <ApiErrorScreen error={events.error} onRetry={() => void events.refetch()} />;
  // 開催日の新しい順（APIもこの順で返すが、画面でもそろえる）
  const list = [...events.data].sort((a, b) => (a.heldOn < b.heldOn ? 1 : a.heldOn > b.heldOn ? -1 : 0));
  return (
    <>
      <PageHeader title="イベント" actions={create} />
      <PageBody>
        {list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">まだイベントがありません。アンケートを取り込むときにも作れます。</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {list.map((e) => (
              <li key={e.id}>
                <Link to={eventPath(e.id)} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-accent">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{e.name}</span>
                      {e.isOwn && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">自分の会</span>}
                    </div>
                    <div className="text-sm text-muted-foreground">{formatHeldOn(e.heldOn)}</div>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">参加 {e.attendeeCount}人</span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}

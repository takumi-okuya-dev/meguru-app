// イベントの一覧（/collect。specs/collect/001-event-day-collection FR-012、contracts/ui-routes.md 1、tasks.md T028）。
// 開催日時の近い順（今日からのイベント → 過ぎたイベント）。名簿の人数・来場の数・振込待ち・締めたかを出す。
import { useQuery } from "@tanstack/react-query";
import { CalendarPlusIcon, MapPinIcon } from "lucide-react";
import { Link } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { formatJstWithWeekday } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { collectApi } from "../lib/api";
import { collectSettingsPath, eventEditPath, newEventPath, rosterPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";

/**
 * イベントの一覧の画面。
 * @returns 画面
 */
export function EventsPage() {
  const events = useQuery({ queryKey: collectQueryKeys.events, queryFn: collectApi.events });
  const me = useQuery({ queryKey: collectQueryKeys.me, queryFn: collectApi.me });
  if (events.isPending) return <LoadingSkeleton />;
  if (events.isLoadingError) return <ApiErrorScreen error={events.error} onRetry={() => void events.refetch()} />;
  const list = events.data.events;
  const needsSetup = me.data && (!me.data.hasPaypayQr || !me.data.hasBankText);
  return (
    <>
      <PageHeader
        title="イベント"
        actions={
          <Button asChild size="sm">
            <Link to={newEventPath()}>
              <CalendarPlusIcon className="size-4" /> <span className="hidden sm:inline">イベントを作る</span>
              <span className="sm:hidden">作る</span>
            </Link>
          </Button>
        }
      />
      <PageBody className="space-y-4">
        {needsSetup && (
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
            受付でPayPayのQRや振込先をすぐ出せるよう、
            <Link to={collectSettingsPath()} className="underline underline-offset-4">
              PayPay・振込先の設定
            </Link>
            を先に済ませておくと便利です。
          </div>
        )}
        {list.length === 0 ? (
          <div className="space-y-3 rounded-xl border px-4 py-10 text-center">
            <p className="font-medium">まだイベントがありません</p>
            <p className="text-sm text-muted-foreground">イベントを作り、申込の名簿を入れておくと、当日の受付が1タップになります。</p>
            <Button asChild>
              <Link to={newEventPath()}>イベントを作る</Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {list.map((e) => (
              <li key={e.id} className="space-y-3 rounded-xl border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <Link to={rosterPath(e.id)} className="block truncate font-medium hover:underline">
                      {e.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span>{formatJstWithWeekday(e.startsAt)}</span>
                      {e.venue && (
                        <span className="inline-flex items-center gap-1">
                          <MapPinIcon className="size-3.5" aria-hidden="true" />
                          {e.venue}
                        </span>
                      )}
                      {e.closedAt && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">締めた</span>}
                    </div>
                  </div>
                  <dl className="flex gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">名簿</dt>
                      <dd className="tabular-nums">{e.rosterCount}人</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">来場</dt>
                      <dd className="tabular-nums">{e.attendedCount}人</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">振込待ち</dt>
                      <dd className="tabular-nums">{e.awaitingTransferCount}件</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to={rosterPath(e.id)}>名簿</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link to={eventEditPath(e.id)}>直す</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}

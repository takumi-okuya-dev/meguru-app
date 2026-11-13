// 受付（主催者。/collect/events/:eventId/reception。specs/collect/001-event-day-collection User Story 2、tasks.md T042）。
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { formatJstWithWeekday } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { ReceptionBoard } from "../components/reception/ReceptionBoard";
import { collectApi } from "../lib/api";
import { helpersPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";
import { useReception, type ReceptionSource } from "../lib/use-reception";

/**
 * 主催者の受付の画面。
 * @returns 画面
 */
export function ReceptionPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const source = useMemo<ReceptionSource>(
    () => ({
      queryKey: collectQueryKeys.reception(eventId),
      viewer: { kind: "owner" },
      snapshot: () => collectApi.reception(eventId),
      record: (personId, input) => collectApi.record(eventId, personId, input),
      undo: (personId) => collectApi.undo(eventId, personId),
      walkIn: (input) => collectApi.walkIn(eventId, input),
      liveTicket: () => collectApi.liveTicket(eventId),
    }),
    [eventId],
  );
  const state = useReception(source);
  if (state.snapshot.isPending) return <LoadingSkeleton />;
  if (state.snapshot.isLoadingError) return <ApiErrorScreen error={state.snapshot.error} onRetry={() => void state.snapshot.refetch()} />;
  const snap = state.snapshot.data;
  return (
    <>
      <PageHeader
        title="受付"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={helpersPath(eventId)}>
              <span className="hidden sm:inline">受付を手伝ってもらう</span>
              <span className="sm:hidden">手伝い</span>
            </Link>
          </Button>
        }
      />
      <PageBody className="space-y-4">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{snap.event.name}</h2>
          <p className="text-sm text-muted-foreground">
            {formatJstWithWeekday(snap.event.startsAt)}
            {snap.event.venue ? `・${snap.event.venue}` : ""}
          </p>
        </div>
        <ReceptionBoard state={state} snap={snap} qrKey={collectQueryKeys.paypayQr} loadQr={collectApi.paypayQr} />
      </PageBody>
    </>
  );
}

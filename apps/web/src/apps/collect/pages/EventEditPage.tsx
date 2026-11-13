// イベントを直す（/collect/events/:eventId/edit。specs/collect/001-event-day-collection FR-011、tasks.md T029）。消すは PR3。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { PageBody, PageHeader } from "@/shell";
import { EventForm } from "../components/EventForm";
import { collectApi, type EventInput } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { rosterPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";

/**
 * イベントを直す画面。
 * @returns 画面
 */
export function EventEditPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const event = useQuery({ queryKey: collectQueryKeys.event(eventId), queryFn: () => collectApi.event(eventId) });
  const save = useMutation({
    mutationFn: (input: EventInput) => collectApi.updateEvent(eventId, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(collectQueryKeys.event(eventId), saved);
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.events });
      toast.success("保存しました。");
      navigate(rosterPath(eventId));
    },
    onError: (err) => toast.error(collectErrorText(err)),
  });
  if (event.isPending) return <LoadingSkeleton />;
  if (event.isLoadingError) return <ApiErrorScreen error={event.error} onRetry={() => void event.refetch()} />;
  return (
    <>
      <PageHeader title="イベントを直す" />
      <PageBody>
        <EventForm key={event.data.id} event={event.data} submitLabel="保存する" pending={save.isPending} onSubmit={(input) => save.mutate(input)} />
      </PageBody>
    </>
  );
}

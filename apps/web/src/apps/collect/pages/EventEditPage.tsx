// イベントを直す・消す（/collect/events/:eventId/edit。specs/collect/001-event-day-collection FR-011・FR-014、tasks.md T029・T072）。
// 消すときは、名簿と受付の記録が消え、数字だけのまとめが残ることを確かめてから消す。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/shell";
import { EventForm } from "../components/EventForm";
import { collectApi, type EventInput } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { eventsPath, rosterPath } from "../lib/paths";
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
  const [removing, setRemoving] = useState(false);
  const remove = useMutation({
    mutationFn: () => collectApi.deleteEvent(eventId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: collectQueryKeys.event(eventId) });
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.events });
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.summaries });
      // 消したイベントの振込待ちは数えなくなる（サイドバーの数）
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.me });
      toast.success("イベントを消しました。数字はまとめに残しました。");
      navigate(eventsPath());
    },
    onError: (err) => toast.error(collectErrorText(err)),
  });
  if (event.isPending) return <LoadingSkeleton />;
  if (event.isLoadingError) return <ApiErrorScreen error={event.error} onRetry={() => void event.refetch()} />;
  return (
    <>
      <PageHeader title="イベントを直す" />
      <PageBody className="space-y-10">
        <EventForm key={event.data.id} event={event.data} submitLabel="保存する" pending={save.isPending} onSubmit={(input) => save.mutate(input)} />
        <section className="space-y-2 border-t pt-6" aria-labelledby="delete-title">
          <h2 id="delete-title" className="font-medium">
            イベントを消す
          </h2>
          <p className="text-sm text-muted-foreground">名簿と受付の記録、受付用リンクが消えます。来場の数や売上などの数字だけが「まとめ」に残ります。</p>
          <Button type="button" variant="destructive" size="sm" onClick={() => setRemoving(true)}>
            イベントを消す
          </Button>
        </section>
      </PageBody>
      {removing && (
        <ConfirmDialog
          title="イベントを消しますか？"
          confirmLabel="消す"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setRemoving(false)}
        >
          <p>「{event.data.name}」の名簿・受付の記録・受付用リンクを消します。参加者の名前は残りません。数字のまとめだけが残ります。元に戻せません。</p>
        </ConfirmDialog>
      )}
    </>
  );
}

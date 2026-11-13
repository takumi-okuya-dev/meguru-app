// イベントを作る（/collect/events/new。specs/collect/001-event-day-collection FR-010、tasks.md T029）。
// 「Threadsのイベントから選ぶ」は PR4 まで出さない。作ったら名簿へ移る。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/shell";
import { EventForm } from "../components/EventForm";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { rosterPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";

/**
 * イベントを作る画面。
 * @returns 画面
 */
export function EventNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: collectApi.createEvent,
    onSuccess: (event) => {
      queryClient.setQueryData(collectQueryKeys.event(event.id), event);
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.events });
      toast.success("イベントを作りました。名簿を入れましょう。");
      navigate(rosterPath(event.id));
    },
    onError: (err) => toast.error(collectErrorText(err)),
  });
  return (
    <>
      <PageHeader title="イベントを作る" />
      <PageBody>
        <EventForm submitLabel="作る" pending={create.isPending} onSubmit={(input) => create.mutate(input)} />
      </PageBody>
    </>
  );
}

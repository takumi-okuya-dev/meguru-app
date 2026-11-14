// 「/people/events/new」：イベントを作る（specs/people/001-people-memo contracts/ui-routes.md 1）。名前・開催日・自分の会か。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { describeError } from "@/lib/api-client";
import { PageBody, PageHeader } from "@/shell";
import { EventForm } from "../components/EventForm";
import { peopleApi } from "../lib/api";
import { eventPath, eventsPath } from "../lib/paths";
import { refreshEvents } from "../lib/refresh";

/**
 * イベントを作る画面。作ったらイベントのページへ移る。
 * @returns 画面
 */
export function EventNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: peopleApi.createEvent,
    onSuccess: async (event) => {
      await refreshEvents(queryClient);
      void navigate(eventPath(event.id));
    },
  });
  return (
    <>
      <PageHeader title="イベントを作る" />
      <PageBody>
        <EventForm
          submitLabel="作る"
          pending={create.isPending}
          error={create.isError ? describeError(create.error) : null}
          onSubmit={(input) => create.mutate(input)}
          onCancel={() => void navigate(eventsPath())}
        />
      </PageBody>
    </>
  );
}

// 「/people/events/:eventId」：イベントのページ（specs/people/001-people-memo contracts/ui-routes.md 1、research.md R14）。
// 参加者数（自分の会は初めて・前にも来た。消した人の数も）・来た人の一覧（押すと人のページ。自分の会は「初めて」の印）・
// 取り込みの一覧と「取り消す」・直す・消す。
import type { UndoResult } from "@meguru/shared/people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ApiError, describeError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { NotFound, PageBody, PageHeader } from "@/shell";
import { EventForm } from "../components/EventForm";
import { formatHeldOn } from "../components/format";
import { UndoConfirmDialog } from "../components/UndoConfirmDialog";
import { peopleApi } from "../lib/api";
import { eventsPath, importPath, personPath } from "../lib/paths";
import { peopleQueryKeys } from "../lib/query-keys";

/**
 * 取り消し・消すの結果の文。
 * @param r - 結果
 * @returns 文
 */
function undoMessage(r: UndoResult): string {
  return r.keptPeopleCount > 0 ? `${r.removedPeopleCount}人を消し、${r.keptPeopleCount}人を残しました` : `${r.removedPeopleCount}人を消しました`;
}

/**
 * イベントのページ。
 * @returns 画面
 */
export function EventPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: peopleQueryKeys.event(eventId), queryFn: () => peopleApi.event(eventId) });
  const attendees = useQuery({ queryKey: peopleQueryKeys.attendees(eventId), queryFn: () => peopleApi.attendees(eventId) });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (input: Parameters<typeof peopleApi.updateEvent>[1]) => peopleApi.updateEvent(eventId, input),
    onSuccess: async () => {
      setEditing(false);
      // 開催日・自分の会かが変わると、初めて・前にも来た・リピーター・次の自分の会・「前に来た」の候補も変わる
      await queryClient.invalidateQueries({ queryKey: peopleQueryKeys.all });
    },
  });

  if (detail.isPending) return <LoadingSkeleton />;
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.code === "ITEM_NOT_FOUND") return <NotFound message="このイベントはありません" />;
    return <ApiErrorScreen error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  const { event, stats, imports } = detail.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: peopleQueryKeys.all });

  return (
    <>
      <PageHeader
        title={event.name}
        actions={
          <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="イベントを直す" onClick={() => setEditing(true)}>
            <PencilIcon className="size-5" />
          </Button>
        }
      />
      <PageBody className="space-y-6">
        <section className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{formatHeldOn(event.heldOn)}</span>
            {event.isOwn && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">自分の会</span>}
          </div>
          <p className="text-2xl font-semibold tabular-nums">
            参加者 {stats.attendeeCount}人
          </p>
          {event.isOwn && stats.firstTimeCount !== undefined && stats.returningCount !== undefined && (
            <p className="flex flex-wrap gap-x-3 text-sm tabular-nums">
              <span>初めて {stats.firstTimeCount}人</span>
              <span>前にも来た {stats.returningCount}人</span>
            </p>
          )}
          {stats.erasedCount > 0 && <p className="text-sm text-muted-foreground">消した人 {stats.erasedCount}人</p>}
        </section>

        <section className="space-y-2" aria-labelledby="attendees-heading">
          <h2 id="attendees-heading" className="text-sm font-medium text-muted-foreground">
            来た人
          </h2>
          {attendees.isPending ? (
            <p className="text-sm text-muted-foreground">読み込んでいます…</p>
          ) : attendees.isError ? (
            <p className="text-sm text-destructive">{describeError(attendees.error)}</p>
          ) : attendees.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              まだいません。<Link to={importPath()} className="underline">アンケートを取り込む</Link>
            </p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {attendees.data.map((a) => (
                <li key={a.personId}>
                  <Link to={personPath(a.personId)} className="flex min-h-11 items-center gap-2 px-4 py-2 text-sm hover:bg-accent">
                    <span className="min-w-0 flex-1 truncate">{a.displayName}</span>
                    {a.firstTime === true && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">初めて</span>}
                    {a.lineName && a.lineName !== a.displayName && <span className="min-w-0 truncate text-muted-foreground">LINE：{a.lineName}</span>}
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="imports-heading">
          <h2 id="imports-heading" className="text-sm font-medium text-muted-foreground">
            取り込み
          </h2>
          {imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだ取り込んでいません。</p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div>{formatDateTime(i.createdAt)}</div>
                    <div className="text-muted-foreground">
                      {i.rowCount}行のうち {i.importedCount}件を取り込み（新しい人 {i.createdPeopleCount}人・つないだ人 {i.linkedCount}人・取り込まなかった行 {i.skippedCount}件）
                    </div>
                  </div>
                  <Button variant="outline" className="h-11 rounded-full md:h-9" onClick={() => setUndoing(i.id)}>
                    取り消す
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-t pt-6">
          <Button variant="outline" className="h-11 rounded-full text-destructive md:h-9" onClick={() => setDeleting(true)}>
            <Trash2Icon /> このイベントを消す
          </Button>
        </section>
      </PageBody>

      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(false)}>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogTitle>イベントを直す</DialogTitle>
            <EventForm
              initial={{ name: event.name, heldOn: event.heldOn, isOwn: event.isOwn }}
              submitLabel="保存"
              pending={update.isPending}
              error={update.isError ? describeError(update.error) : null}
              onSubmit={(input) => update.mutate(input)}
              onCancel={() => setEditing(false)}
            />
          </DialogContent>
        </Dialog>
      )}
      {undoing && (
        <UndoConfirmDialog
          title="この取り込みを取り消しますか？"
          confirmLabel="取り消す"
          queryKey={peopleQueryKeys.undoPreview(undoing)}
          queryFn={() => peopleApi.undoPreview(undoing)}
          run={(keep) => peopleApi.undoImport(undoing, keep)}
          onDone={(r) => {
            setUndoing(null);
            toast.success(`取り込みを取り消しました。${undoMessage(r)}`);
            void refresh();
          }}
          onCancel={() => setUndoing(null)}
        />
      )}
      {deleting && (
        <UndoConfirmDialog
          title="このイベントを消しますか？"
          confirmLabel="消す"
          queryKey={peopleQueryKeys.eventDeletePreview(eventId)}
          queryFn={() => peopleApi.eventDeletePreview(eventId)}
          run={(keep) => peopleApi.deleteEvent(eventId, keep)}
          onDone={(r) => {
            setDeleting(false);
            toast.success(`イベントを消しました。${undoMessage(r)}`);
            queryClient.removeQueries({ queryKey: peopleQueryKeys.event(eventId) });
            // 消した会の声かけも消えるので、人物メモのデータをすべて読み直す
            void queryClient.invalidateQueries({ queryKey: peopleQueryKeys.all });
            void navigate(eventsPath(), { replace: true });
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  );
}

// 名簿（/collect/events/:eventId/roster。specs/collect/001-event-day-collection User Story 1、FR-020〜FR-027、tasks.md T030）。
// 上に続けて入れる欄（媒体・区分のボタン・候補）、「まとめて貼る」、下に名簿の表（受付番号の順。直す・消す）。
import { COLLECT_MEDIA_LABELS, type CollectMedia, type RosterPerson } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPasteIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { formatJstShort, formatJstWithWeekday } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { BulkPasteDialog } from "../components/roster/BulkPasteDialog";
import { PersonDialog } from "../components/roster/PersonDialog";
import { QuickAdd } from "../components/roster/QuickAdd";
import { collectApi, type PersonInput } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { eventEditPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";

/**
 * Threads から作ったイベントで、元の宣伝内容が直された・消されたことの知らせ（集金管理のイベントは自動で変えない。FR-063）。
 * @param props - sourceChangedAt・sourceDeletedAt：元が直された・消された時刻
 * @returns 知らせ（どちらもなければ何も出さない）
 */
export function SourceNotice({ sourceChangedAt, sourceDeletedAt }: { sourceChangedAt: string | null; sourceDeletedAt: string | null }) {
  if (!sourceChangedAt && !sourceDeletedAt) return null;
  return (
    <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      {sourceDeletedAt
        ? "元の Threads の宣伝内容のイベントの情報が消されました。このイベントはそのまま残ります。"
        : `元の Threads の宣伝内容が直されました（${formatJstShort(sourceChangedAt!)}）。必要なら「イベントを直す」で合わせてください。`}
    </p>
  );
}

/**
 * 名簿の画面。
 * @returns 画面
 */
export function RosterPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const queryClient = useQueryClient();
  const event = useQuery({ queryKey: collectQueryKeys.event(eventId), queryFn: () => collectApi.event(eventId) });
  const roster = useQuery({ queryKey: collectQueryKeys.roster(eventId), queryFn: () => collectApi.roster(eventId) });
  const [media, setMedia] = useState<CollectMedia>("peatix");
  const [chosenTier, setChosenTier] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [editing, setEditing] = useState<RosterPerson | null>(null);
  const [removing, setRemoving] = useState<RosterPerson | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: collectQueryKeys.roster(eventId) });
    void queryClient.invalidateQueries({ queryKey: collectQueryKeys.events });
    // 名簿に入った人は候補に出さない（FR-027）ので、候補も読み直す
    void queryClient.invalidateQueries({ queryKey: collectQueryKeys.pastAttendeesOf(eventId) });
  };
  const add = useMutation({ mutationFn: (input: PersonInput) => collectApi.addPerson(eventId, input), onSuccess: refresh });
  const bulk = useMutation({
    mutationFn: ({ names, referrer }: { names: string[]; referrer: string | null }) => collectApi.addPeopleBulk(eventId, { names, media, priceTierId: tierId, referrer }),
    onSuccess: refresh,
  });
  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: PersonInput }) => collectApi.updatePerson(eventId, id, input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => collectApi.deletePerson(eventId, id), onSuccess: refresh });

  const tiers = event.data?.tiers ?? [];
  // 選んだ区分がなくなった（直す画面で消した）ときは、最初の区分に戻す
  const tierId = tiers.some((t) => t.id === chosenTier) ? chosenTier! : (tiers[0]?.id ?? "");
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));

  if (event.isPending || roster.isPending) return <LoadingSkeleton />;
  if (event.isLoadingError) return <ApiErrorScreen error={event.error} onRetry={() => void event.refetch()} />;
  if (roster.isLoadingError) return <ApiErrorScreen error={roster.error} onRetry={() => void roster.refetch()} />;
  const people = roster.data.people;

  /**
   * 1人足す。同じ名前の人がいれば知らせる（足すことは止めない。FR-024）。
   * @param input - 入力
   * @returns 足せたら true
   */
  const addOne = async (input: PersonInput): Promise<boolean> => {
    try {
      const res = await add.mutateAsync(input);
      if (res.sameNameAs) {
        toast.info(`同じ名前の人がいます（No.${res.sameNameAs.number}・${COLLECT_MEDIA_LABELS[res.sameNameAs.media]}）。2人とも名簿に入れました。`);
      }
      return true;
    } catch (err) {
      toast.error(collectErrorText(err));
      return false;
    }
  };

  return (
    <>
      <PageHeader
        title="名簿"
        actions={
          <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
            <ClipboardPasteIcon className="size-4" /> <span className="hidden sm:inline">まとめて貼る</span>
            <span className="sm:hidden">貼る</span>
          </Button>
        }
      />
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate font-medium">{event.data.name}</h2>
            <p className="text-sm text-muted-foreground">
              {formatJstWithWeekday(event.data.startsAt)}
              {event.data.venue ? `・${event.data.venue}` : ""}
            </p>
          </div>
          <Link to={eventEditPath(eventId)} className="text-sm underline underline-offset-4">
            イベントを直す
          </Link>
        </div>
        <SourceNotice sourceChangedAt={event.data.sourceChangedAt} sourceDeletedAt={event.data.sourceDeletedAt} />
        <QuickAdd
          eventId={eventId}
          tiers={tiers}
          media={media}
          postedMedia={event.data.threadsPostedMedia}
          tierId={tierId}
          onMediaChange={setMedia}
          onTierChange={setChosenTier}
          onAdd={addOne}
          pending={add.isPending}
        />
        <section aria-labelledby="roster-title" className="space-y-2">
          <h2 id="roster-title" className="text-sm text-muted-foreground">
            名簿 {people.length}人
          </h2>
          {people.length === 0 ? (
            <p className="rounded-xl border px-4 py-6 text-center text-sm text-muted-foreground">まだだれもいません。上の欄に名前を入れるか、申込の一覧を「まとめて貼る」で入れてください。</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-normal">No.</th>
                    <th className="px-3 py-2 font-normal">名前</th>
                    <th className="px-3 py-2 font-normal">媒体</th>
                    <th className="px-3 py-2 font-normal">区分</th>
                    <th className="px-3 py-2 font-normal">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-3 py-2 tabular-nums">{p.number}</td>
                      <td className="px-3 py-2">
                        <div>{p.name}</div>
                        {(p.kana || p.memo || p.referrer) && (
                          <div className="text-xs text-muted-foreground">
                            {[p.kana, p.referrer && `紹介：${p.referrer}`, p.memo].filter(Boolean).join("・")}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{COLLECT_MEDIA_LABELS[p.media]}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{tierName.get(p.priceTierId) ?? ""}</td>
                      <td className="px-1 py-1 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" aria-label={`No.${p.number} ${p.name}を直す`} onClick={() => setEditing(p)}>
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`No.${p.number} ${p.name}を消す`} onClick={() => setRemoving(p)}>
                          <Trash2Icon className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PageBody>
      {pasting && (
        <BulkPasteDialog
          media={media}
          tier={tiers.find((t) => t.id === tierId)}
          pending={bulk.isPending}
          onClose={() => setPasting(false)}
          onSubmit={async (names, referrer) => {
            try {
              const res = await bulk.mutateAsync({ names, referrer });
              toast.success(`${res.people.length}人を足しました。`);
              return true;
            } catch (err) {
              toast.error(collectErrorText(err));
              return false;
            }
          }}
        />
      )}
      {editing && (
        <PersonDialog
          person={editing}
          tiers={tiers}
          pending={update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            try {
              await update.mutateAsync({ id: editing.id, input });
              return true;
            } catch (err) {
              toast.error(collectErrorText(err));
              return false;
            }
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`No.${removing.number} ${removing.name}を消しますか？`}
          confirmLabel="消す"
          destructive
          pending={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            remove.mutate(removing.id, {
              onSuccess: () => setRemoving(null),
              onError: (err) => toast.error(collectErrorText(err)),
            })
          }
        >
          <p>受付の記録があれば、それも消えます。受付番号は使い回しません。</p>
        </ConfirmDialog>
      )}
    </>
  );
}

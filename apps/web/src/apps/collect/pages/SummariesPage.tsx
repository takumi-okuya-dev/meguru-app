// 消したイベントのまとめ（/collect/summaries。specs/collect/001-event-day-collection FR-014、tasks.md T072）。数字だけで、名前は入っていない。
import { COLLECT_MEDIA_LABELS, RECEPTION_METHOD_LABELS, RECEPTION_METHODS, type EventSummary } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { formatJstWithWeekday } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/**
 * まとめの内訳（払い方ごとの件数と合計・媒体ごとの名簿・来場・売上。FR-014）。開いたときだけ出す。
 * @param props - summary：まとめ
 * @returns 内訳
 */
function SummaryDetail({ summary }: { summary: EventSummary }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">内訳を見る</summary>
      <div className="mt-2 space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full" aria-label={`${summary.name}の払い方ごと`}>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">払い方</th>
                <th className="py-1 pr-3 font-normal">件数</th>
                <th className="py-1 font-normal">合計</th>
              </tr>
            </thead>
            <tbody>
              {RECEPTION_METHODS.map((m) => (
                <tr key={m} className="border-t">
                  <td className="py-1 pr-3">{RECEPTION_METHOD_LABELS[m]}</td>
                  <td className="py-1 pr-3 tabular-nums">{summary.byMethod[m].count}件</td>
                  <td className="py-1 tabular-nums">{yen(summary.byMethod[m].amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.byMedia.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full" aria-label={`${summary.name}の媒体ごと`}>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">媒体</th>
                  <th className="py-1 pr-3 font-normal">名簿</th>
                  <th className="py-1 pr-3 font-normal">来場</th>
                  <th className="py-1 pr-3 font-normal">支払い済み</th>
                  <th className="py-1 font-normal">振込待ち</th>
                </tr>
              </thead>
              <tbody>
                {summary.byMedia.map((m) => (
                  <tr key={m.media} className="border-t">
                    <td className="py-1 pr-3">{COLLECT_MEDIA_LABELS[m.media]}</td>
                    <td className="py-1 pr-3 tabular-nums">{m.roster}人</td>
                    <td className="py-1 pr-3 tabular-nums">{m.attended}人</td>
                    <td className="py-1 pr-3 tabular-nums">{yen(m.paid)}</td>
                    <td className="py-1 tabular-nums">{yen(m.awaiting)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * まとめの画面。
 * @returns 画面
 */
export function SummariesPage() {
  const queryClient = useQueryClient();
  const summaries = useQuery({ queryKey: collectQueryKeys.summaries, queryFn: collectApi.summaries });
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => collectApi.deleteSummary(id),
    onSuccess: () => {
      setRemoving(null);
      toast.success("まとめを消しました。");
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.summaries });
    },
    onError: (e) => toast.error(collectErrorText(e)),
  });
  if (summaries.isPending) return <LoadingSkeleton />;
  if (summaries.isLoadingError) return <ApiErrorScreen error={summaries.error} onRetry={() => void summaries.refetch()} />;
  const list = summaries.data.summaries;
  return (
    <>
      <PageHeader title="まとめ" />
      <PageBody className="space-y-4">
        <p className="text-sm text-muted-foreground">消したイベントの数字です。参加者の名前は残っていません。</p>
        {list.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">まだありません。</p>
        ) : (
          <ul className="space-y-2">
            {list.map((s) => {
              const transfer = s.byMethod.transfer_today.amount + s.byMethod.transfer_later.amount;
              return (
                <li key={s.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start" aria-label={s.name}>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{formatJstWithWeekday(s.startsAt)}</div>
                    <div className="text-sm">
                      来場 {s.attendedCount} / {s.rosterCount}人・現金 {yen(s.byMethod.cash.amount)}・PayPay {yen(s.byMethod.paypay.amount)}・振込 {yen(transfer)}
                      {s.awaitingTransfer.count > 0 && `（うち振込待ち ${s.awaitingTransfer.count}件・${yen(s.awaitingTransfer.amount)}）`}
                    </div>
                    <SummaryDetail summary={s} />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving({ id: s.id, name: s.name })}>
                    消す
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
      {removing && (
        <ConfirmDialog
          title="まとめを消しますか？"
          confirmLabel="消す"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onCancel={() => setRemoving(null)}
        >
          <p>「{removing.name}」のまとめを消します。元に戻せません。</p>
        </ConfirmDialog>
      )}
    </>
  );
}

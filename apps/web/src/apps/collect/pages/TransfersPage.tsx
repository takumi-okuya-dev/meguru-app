// 振込待ち（/collect/transfers。specs/collect/001-event-day-collection User Story 5、FR-050〜FR-052、tasks.md T066）。
// すべてのイベントの振込待ち（受付番号・名前で探す）。「入金を確かめた」で支払い済みに、間違えたら戻す。連絡文はコピーして送る（アプリからは送らない）。
import { buildTransferMessage, type TransferItem } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatJstMonthDay, formatJstShort } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/**
 * 振込待ちの画面。
 * @returns 画面
 */
export function TransfersPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const transfers = useQuery({ queryKey: collectQueryKeys.transfers(q), queryFn: () => collectApi.transfers(q), placeholderData: (prev) => prev });
  const settings = useQuery({ queryKey: collectQueryKeys.settings, queryFn: collectApi.settings });
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: collectQueryKeys.transfersAll });
    void queryClient.invalidateQueries({ queryKey: collectQueryKeys.me });
    void queryClient.invalidateQueries({ queryKey: collectQueryKeys.events });
  };
  const confirm = useMutation({
    mutationFn: ({ personId, confirmed }: { personId: string; confirmed: boolean }) =>
      confirmed ? collectApi.confirmTransfer(personId) : collectApi.unconfirmTransfer(personId),
    onSuccess: (_, { confirmed }) => {
      toast.success(confirmed ? "入金を確かめました。" : "振込待ちに戻しました。");
      refresh();
    },
    onError: (e) => toast.error(collectErrorText(e)),
  });

  const copy = async (t: TransferItem) => {
    const text = buildTransferMessage({ name: t.name, eventName: t.eventName, amount: t.amount, number: t.number, kana: t.kana, bankText: settings.data?.bankText ?? null });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("連絡文をコピーしました。");
    } catch {
      setManualCopy(text);
    }
  };

  if (transfers.isPending) return <LoadingSkeleton />;
  if (transfers.isLoadingError) return <ApiErrorScreen error={transfers.error} onRetry={() => void transfers.refetch()} />;
  const { awaiting, confirmed } = transfers.data;

  const row = (t: TransferItem, done: boolean) => (
    <li key={t.personId} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center" aria-label={`No.${t.number} ${t.name}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">No.{t.number}</span>
          <span className="truncate font-medium">{t.name}</span>
          <span className="tabular-nums">{yen(t.amount)}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {t.eventName}（{formatJstMonthDay(t.eventStartsAt)}）・{t.method === "transfer_today" ? "当日" : "後日"}・受付 {formatJstShort(t.recordedAt)}
          {t.transferConfirmedAt && `・確かめた ${formatJstShort(t.transferConfirmedAt)}`}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {done ? (
          <Button type="button" variant="ghost" size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate({ personId: t.personId, confirmed: false })}>
            振込待ちに戻す
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy(t)}>
              <CopyIcon className="size-4" /> 連絡文をコピー
            </Button>
            <Button type="button" size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate({ personId: t.personId, confirmed: true })}>
              入金を確かめた
            </Button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <>
      <PageHeader title="振込待ち" />
      <PageBody className="space-y-6">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="受付番号・名前で探す" placeholder="受付番号・名前で探す" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <section className="space-y-3" aria-labelledby="awaiting-title">
          <h2 id="awaiting-title" className="font-medium">
            振込待ち {awaiting.length}件・{yen(awaiting.reduce((s, t) => s + t.amount, 0))}
          </h2>
          {awaiting.length === 0 ? <p className="text-sm text-muted-foreground">振込待ちの人はいません。</p> : <ul className="space-y-2">{awaiting.map((t) => row(t, false))}</ul>}
        </section>
        {confirmed.length > 0 && (
          <section className="space-y-3" aria-labelledby="confirmed-title">
            <h2 id="confirmed-title" className="font-medium">
              確かめた振込
            </h2>
            <ul className="space-y-2">{confirmed.map((t) => row(t, true))}</ul>
          </section>
        )}
      </PageBody>
      {manualCopy && (
        <Dialog open onOpenChange={(v) => !v && setManualCopy(null)}>
          <DialogContent className="sm:max-w-lg" aria-describedby="manual-copy-desc">
            <DialogTitle>連絡文</DialogTitle>
            <DialogDescription id="manual-copy-desc">コピーできませんでした。文を選んでコピーしてください。</DialogDescription>
            <Textarea aria-label="連絡文" rows={10} readOnly value={manualCopy} onFocus={(e) => e.currentTarget.select()} autoFocus />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

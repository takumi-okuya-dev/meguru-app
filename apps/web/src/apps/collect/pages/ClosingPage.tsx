// 締め（/collect/events/:eventId/closing。specs/collect/001-event-day-collection User Story 4、FR-040〜FR-046、tasks.md T060）。
// 現金は受け取った人ごとに、渡された額を入れて差を見て「精算した」。PayPay は「履歴と合った」。振込・媒体ごと・来なかった人を見て「締める」。
// 精算していない人がいれば締める前に知らせる（止めない）。締めたあとに受付の記録が変わったら知らせる。書き出しは CSV。
import { COLLECT_MEDIA_LABELS, type CashReceiver, type ClosingSnapshot } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJstShort } from "@/lib/format";
import { saveFile } from "@/lib/save-file";
import { PageBody, PageHeader } from "@/shell";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { receptionPath, sharingPath, transfersPath } from "../lib/paths";
import { useLive } from "../lib/live";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/**
 * API のファイル名が読めないときの CSV のファイル名（API の export-csv.ts と同じく、ファイル名に使えない文字は _ にする）。
 * @param event - イベント（名前と始まる時刻）
 * @returns 「集金_2026-11-20_IT交流会.csv」
 */
export function fallbackCsvName(event: { name: string; startsAt: string }): string {
  const day = new Date(new Date(event.startsAt).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return `集金_${day}_${event.name.replace(/[\\/:*?"<>|\r\n]/g, "_")}.csv`;
}

/**
 * 渡された額と合計の差の言葉。
 * @param counted - 渡された額
 * @param amount - 合計（あるはずの額）
 * @returns 「合っている」「500円多い」「500円足りない」
 */
export function diffText(counted: number, amount: number): string {
  if (counted === amount) return "合っている";
  return counted > amount ? `${yen(counted - amount)}多い` : `${yen(amount - counted)}足りない`;
}

/**
 * 受け取った人ごとの精算の行。
 * @param props - receiver：精算の行、pending：保存中か、onCounted：渡された額を保存する、onSettled：精算した・外す
 * @returns 行
 */
function CashRow({
  receiver,
  pending,
  onCounted,
  onSettled,
}: {
  receiver: CashReceiver;
  pending: boolean;
  onCounted: (amount: number | null) => void;
  onSettled: (settled: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (receiver.countedAmount === null ? "" : String(receiver.countedAmount));
  const digits = text.normalize("NFKC").replace(/[,\s円]/g, "");
  const parsed = digits === "" ? null : Number(digits);
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 0);
  const save = () => {
    if (draft === null || invalid) return;
    onCounted(parsed);
    setDraft(null);
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center" aria-label={`${receiver.name}の精算`}>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{receiver.name}</div>
        <div className="text-sm text-muted-foreground">
          {receiver.count}件・{yen(receiver.amount)}
          {receiver.settledAt && <span>・精算した（{formatJstShort(receiver.settledAt)}）</span>}
        </div>
        {receiver.changedAfterSettle && <div className="text-sm text-amber-700 dark:text-amber-400">精算したあとで、この人の現金の記録が変わりました。</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`${receiver.name}から渡された額`}
          inputMode="numeric"
          placeholder="渡された額"
          className="w-32"
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        {parsed !== null && !invalid && <span className="text-sm tabular-nums">{diffText(parsed, receiver.amount)}</span>}
        <Button type="button" variant={receiver.settledAt ? "outline" : "default"} size="sm" disabled={pending} onClick={() => onSettled(!receiver.settledAt)}>
          {receiver.settledAt ? "精算を外す" : "精算した"}
        </Button>
      </div>
    </li>
  );
}

/**
 * 締めの画面。
 * @returns 画面
 */
export function ClosingPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const queryClient = useQueryClient();
  const closing = useQuery({ queryKey: collectQueryKeys.closing(eventId), queryFn: () => collectApi.closing(eventId) });
  // 締めの画面を開いている間も、会場の受付（手伝う人の記録・取り消し・飛び入り）が続くことがある。会場の共有の知らせが来たら
  // 数字を読み直す（つながらない間は15秒ごと）。古い数字のまま精算・締めをしないため
  const refresh = () => void queryClient.invalidateQueries({ queryKey: collectQueryKeys.closing(eventId) });
  useLive({ enabled: closing.data !== undefined, getTicket: () => collectApi.liveTicket(eventId), onMessage: refresh, onResync: refresh });
  const [confirmClose, setConfirmClose] = useState(false);
  const set = (next: ClosingSnapshot) => queryClient.setQueryData(collectQueryKeys.closing(eventId), next);
  const settle = useMutation({
    mutationFn: ({ key, input }: { key: string; input: { countedAmount?: number | null; settled?: boolean } }) => collectApi.settle(eventId, key, input),
    onSuccess: set,
    onError: (e) => toast.error(collectErrorText(e)),
  });
  const paypay = useMutation({ mutationFn: () => collectApi.checkPaypay(eventId), onSuccess: set, onError: (e) => toast.error(collectErrorText(e)) });
  const close = useMutation({
    mutationFn: () => collectApi.close(eventId),
    onSuccess: () => {
      setConfirmClose(false);
      toast.success("締めました。");
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.closing(eventId) });
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.events });
    },
    onError: (e) => toast.error(collectErrorText(e)),
  });
  const exportCsv = useMutation({
    mutationFn: () => collectApi.exportCsv(eventId),
    // ファイル名は API が付けたもの（使えない文字は API が置き換える）。読めないときだけ画面で作る
    onSuccess: ({ blob, filename }) => saveFile(blob, filename ?? fallbackCsvName(closing.data!.event)),
    onError: (e) => toast.error(collectErrorText(e)),
  });

  if (closing.isPending) return <LoadingSkeleton />;
  if (closing.isLoadingError) return <ApiErrorScreen error={closing.error} onRetry={() => void closing.refetch()} />;
  const c = closing.data;
  const unsettled = c.cashByReceiver.filter((r) => r.amount > 0 && (!r.settledAt || r.changedAfterSettle));
  const section = "space-y-3";

  return (
    <>
      <PageHeader
        title="締め"
        actions={
          <Button type="button" variant="outline" size="sm" disabled={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
            <DownloadIcon className="size-4" /> <span className="hidden sm:inline">書き出す（CSV）</span>
            <span className="sm:hidden">CSV</span>
          </Button>
        }
      />
      <PageBody className="space-y-8">
        <div className="space-y-2">
          <h2 className="truncate font-medium">{c.event.name}</h2>
          <p className="text-sm text-muted-foreground">
            来場 {c.attendance.arrived} / {c.attendance.rosterCount}人{c.closedAt && `・締めた（${formatJstShort(c.closedAt)}）`}
          </p>
          <p className="text-sm">
            <Link to={sharingPath(eventId)} className="underline underline-offset-2">
              経費を入れて、運営メンバーへの分配を見る
            </Link>
          </p>
          {c.changedAfterClose && (
            <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              締めたあとで受付の記録が変わりました。確かめてから、もう一度締めてください。
            </p>
          )}
          {c.awaitingConfirmation.count > 0 && (
            <div role="status" className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>
                確かめ待ちの本人の申告が {c.awaitingConfirmation.count}件（{yen(c.awaitingConfirmation.amount)}）あります。下の現金・PayPayの合計には入っていません。受付の画面で「受け取った」か「取り消す」をしてから締めてください。
              </p>
              <ul className="text-xs text-muted-foreground">
                {c.awaitingConfirmation.people.map((p) => (
                  <li key={p.personId}>
                    No.{p.number} {p.name}・{p.method === "paypay" ? "PayPay" : "現金"} {yen(p.amount)}
                  </li>
                ))}
              </ul>
              <Link to={receptionPath(eventId)} className="text-sm underline">
                受付の画面へ
              </Link>
            </div>
          )}
        </div>

        <section className={section} aria-labelledby="cash-title">
          <h2 id="cash-title" className="font-medium">
            現金（受け取った人ごと）{yen(c.byMethod.cash.amount)}
          </h2>
          <ul className="space-y-2">
            {c.cashByReceiver.map((r) => (
              <CashRow
                key={r.receiverKey}
                receiver={r}
                pending={settle.isPending}
                onCounted={(countedAmount) => settle.mutate({ key: r.receiverKey, input: { countedAmount } })}
                onSettled={(settled) => settle.mutate({ key: r.receiverKey, input: { settled } })}
              />
            ))}
          </ul>
        </section>

        <section className={section} aria-labelledby="paypay-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="paypay-title" className="font-medium">
              PayPay {c.paypay.count}件・{yen(c.paypay.amount)}
            </h2>
            <Button type="button" variant={c.paypay.checkedAt ? "outline" : "default"} size="sm" disabled={paypay.isPending} onClick={() => paypay.mutate()}>
              {c.paypay.checkedAt ? `履歴と合った（${formatJstShort(c.paypay.checkedAt)}）` : "履歴と合った"}
            </Button>
          </div>
          {c.paypay.records.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm" aria-label="PayPayの記録">
              {c.paypay.records.map((p) => (
                <li key={p.personId} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>
                    No.{p.number} {p.name}
                  </span>
                  <span className="text-muted-foreground">
                    {yen(p.amount)}・{formatJstShort(p.recordedAt)}・{p.receiverName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={section} aria-labelledby="transfer-title">
          <h2 id="transfer-title" className="font-medium">
            振込
          </h2>
          <p className="text-sm">
            受け取った {c.transfers.paid.count}件・{yen(c.transfers.paid.amount)}／振込待ち {c.transfers.awaiting.count}件・{yen(c.transfers.awaiting.amount)}
            {c.transfers.awaiting.count > 0 && (
              <Link to={transfersPath()} className="ml-2 underline underline-offset-4">
                振込待ちを見る
              </Link>
            )}
          </p>
        </section>

        <section className={section} aria-labelledby="media-title">
          <h2 id="media-title" className="font-medium">
            媒体ごと
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-normal">媒体</th>
                  <th className="py-2 pr-3 font-normal">名簿</th>
                  <th className="py-2 pr-3 font-normal">来場</th>
                  <th className="py-2 pr-3 font-normal">支払い済み</th>
                  <th className="py-2 font-normal">振込待ち</th>
                </tr>
              </thead>
              <tbody>
                {c.byMedia.map((m) => (
                  <tr key={m.media} className="border-t">
                    <td className="py-2 pr-3">{COLLECT_MEDIA_LABELS[m.media]}</td>
                    <td className="py-2 pr-3 tabular-nums">{m.roster}人</td>
                    <td className="py-2 pr-3 tabular-nums">{m.attended}人</td>
                    <td className="py-2 pr-3 tabular-nums">{yen(m.paid)}</td>
                    <td className="py-2 tabular-nums">{yen(m.awaiting)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {c.checkInMode === "rosterless" ? (
          // 名簿なしでは、記録のない人は「来なかった人」ではない（取り消した人・先に入れた人。specs/collect/004 FR-030）
          <section className={section} aria-labelledby="unrecorded-title">
            <h2 id="unrecorded-title" className="font-medium">
              受付の記録がない人 {c.unrecordedCount}人
            </h2>
            <p className="text-sm text-muted-foreground">名簿なしの受付なので、来なかった人は出しません。記録を取り消した人や、先に名簿に入れた人の数です。</p>
          </section>
        ) : (
          <section className={section} aria-labelledby="absent-title">
            <h2 id="absent-title" className="font-medium">
              来なかった人 {c.absent.length}人
            </h2>
            {c.absent.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm" aria-label="来なかった人">
                {c.absent.map((p) => (
                  <li key={p.personId} className="flex justify-between gap-2 px-3 py-2">
                    <span>
                      No.{p.number} {p.name}
                    </span>
                    <span className="text-muted-foreground">{COLLECT_MEDIA_LABELS[p.media]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="flex justify-end">
          <Button type="button" className="h-11" disabled={close.isPending} onClick={() => (unsettled.length > 0 ? setConfirmClose(true) : close.mutate())}>
            {c.closedAt ? "もう一度締める" : "締める"}
          </Button>
        </div>
      </PageBody>

      {confirmClose && (
        <ConfirmDialog title="精算していない人がいます" confirmLabel="締める" pending={close.isPending} onConfirm={() => close.mutate()} onCancel={() => setConfirmClose(false)}>
          <p>{unsettled.map((r) => r.name).join("・")}の現金を、まだ精算していません。このまま締めますか？（あとで精算して、もう一度締められます）</p>
        </ConfirmDialog>
      )}
    </>
  );
}

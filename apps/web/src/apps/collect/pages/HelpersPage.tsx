// 受付の手伝い（主催者。/collect/events/:eventId/helpers。specs/collect/001-event-day-collection User Story 3、FR-070〜FR-073、tasks.md T051）。
// 受付用リンクを出し、QRとコピーで手伝う人に渡す。期限を変える・止める・出し直す。下に受付をしている人の表（端末の数を含む）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJstShort } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { QrCode } from "../components/QrCode";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { receptionPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/**
 * ISO の時刻を、datetime-local の欄の値（この端末の時刻）にする。
 * @param iso - ISO 8601
 * @returns 「2026-11-20T23:59」
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 受付の手伝いの画面。
 * @returns 画面
 */
export function HelpersPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const queryClient = useQueryClient();
  const link = useQuery({ queryKey: collectQueryKeys.link(eventId), queryFn: () => collectApi.link(eventId) });
  const workers = useQuery({ queryKey: collectQueryKeys.workers(eventId), queryFn: () => collectApi.workers(eventId), refetchInterval: 30_000 });
  const [expiry, setExpiry] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"stop" | "reissue" | null>(null);

  const setLink = (value: Awaited<ReturnType<typeof collectApi.link>>) => queryClient.setQueryData(collectQueryKeys.link(eventId), value);
  const create = useMutation({ mutationFn: () => collectApi.createLink(eventId), onSuccess: setLink, onError: (e) => toast.error(collectErrorText(e)) });
  const update = useMutation({
    mutationFn: (expiresAt: string) => collectApi.updateLink(eventId, expiresAt),
    onSuccess: (v) => {
      setLink(v);
      setExpiry(null);
      toast.success("期限を変えました。");
    },
    onError: (e) => toast.error(collectErrorText(e)),
  });
  const stop = useMutation({
    mutationFn: async (reissue: boolean) => {
      await collectApi.stopLink(eventId);
      return reissue ? collectApi.createLink(eventId) : { link: null };
    },
    onSuccess: (v, reissue) => {
      setLink(v);
      setConfirm(null);
      toast.success(reissue ? "新しいリンクを出しました。前のリンクとQRは使えません。" : "リンクを止めました。手伝う人の画面も止まります。");
    },
    onError: (e) => toast.error(collectErrorText(e)),
  });

  if (link.isPending) return <LoadingSkeleton />;
  if (link.isLoadingError) return <ApiErrorScreen error={link.error} onRetry={() => void link.refetch()} />;
  const current = link.data.link;
  const expired = current !== null && new Date(current.expiresAt).getTime() <= Date.now();

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("リンクをコピーしました。");
    } catch {
      toast.error("コピーできませんでした。リンクを長押しして選んでください。");
    }
  };

  return (
    <>
      <PageHeader
        title="受付の手伝い"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={receptionPath(eventId)}>受付へ</Link>
          </Button>
        }
      />
      <PageBody className="space-y-8">
        <section className="space-y-3" aria-labelledby="link-title">
          <h2 id="link-title" className="font-medium">
            受付用リンク
          </h2>
          <p className="text-sm text-muted-foreground">
            手伝う人はログインなしで、名前を入れるだけで受付ができます（名簿の編集・締めはできません）。会場で直接QRを見せるか、リンクを渡してください。
          </p>
          {current === null ? (
            <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
              受付用リンクを出す
            </Button>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <QrCode value={current.url} />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs select-all">{current.url}</code>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copy(current.url)}>
                    <CopyIcon className="size-4" /> コピー
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <div className="text-sm">
                    期限：{formatJstShort(current.expiresAt)}
                    {expired && <span className="ml-2 text-destructive">（期限が過ぎました。出し直してください）</span>}
                  </div>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (expiry) update.mutate(new Date(expiry).toISOString());
                    }}
                  >
                    <Input
                      type="datetime-local"
                      aria-label="期限"
                      className="w-auto"
                      value={expiry ?? toLocalInput(current.expiresAt)}
                      onChange={(e) => setExpiry(e.target.value)}
                    />
                    <Button type="submit" variant="outline" size="sm" disabled={!expiry || update.isPending}>
                      期限を変える
                    </Button>
                  </form>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("reissue")}>
                    出し直す
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirm("stop")}>
                    止める
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="workers-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="workers-title" className="font-medium">
              受付をしている人
            </h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => void workers.refetch()}>
              <RefreshCwIcon className="size-4" /> 読み直す
            </Button>
          </div>
          {workers.isPending ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
          ) : workers.isError ? (
            <p className="text-sm text-muted-foreground">読めませんでした。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-normal">名前</th>
                    <th className="py-2 pr-3 font-normal">受付</th>
                    <th className="py-2 pr-3 font-normal">受け取った現金</th>
                    <th className="py-2 pr-3 font-normal">最後の受付</th>
                    <th className="py-2 font-normal">端末</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="py-2 pr-3">あなた（主催者）</td>
                    <td className="py-2 pr-3 tabular-nums">{workers.data.owner.recordCount}件</td>
                    <td className="py-2 pr-3 tabular-nums">{yen(workers.data.owner.cashAmount)}</td>
                    <td className="py-2 pr-3">{workers.data.owner.lastRecordedAt ? formatJstShort(workers.data.owner.lastRecordedAt) : "—"}</td>
                    <td className="py-2">—</td>
                  </tr>
                  {workers.data.helpers.map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="py-2 pr-3">
                        {h.name}
                        <span className="ml-1 text-xs text-muted-foreground">（{formatJstShort(h.joinedAt)}から）</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{h.recordCount}件</td>
                      <td className="py-2 pr-3 tabular-nums">{yen(h.cashAmount)}</td>
                      <td className="py-2 pr-3">{h.lastRecordedAt ? formatJstShort(h.lastRecordedAt) : "—"}</td>
                      <td className={h.deviceCount > 1 ? "py-2 font-medium text-amber-700 dark:text-amber-400" : "py-2"}>{h.deviceCount}台</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {workers.data.helpers.some((h) => h.deviceCount > 1) && (
                <p className="mt-2 text-xs text-muted-foreground">端末が2台以上の人は、同じ名前で別の端末から入っています。心当たりがなければ、リンクを出し直してください。</p>
              )}
            </div>
          )}
        </section>
      </PageBody>

      {confirm && (
        <ConfirmDialog
          title={confirm === "stop" ? "受付用リンクを止めますか？" : "受付用リンクを出し直しますか？"}
          confirmLabel={confirm === "stop" ? "止める" : "出し直す"}
          destructive={confirm === "stop"}
          pending={stop.isPending}
          onConfirm={() => stop.mutate(confirm === "reissue")}
          onCancel={() => setConfirm(null)}
        >
          <p>
            {confirm === "stop"
              ? "手伝う人の画面は止まり、受付ができなくなります。手伝う人がした受付の記録は残ります。"
              : "今のリンクとQRは使えなくなります。手伝う人には、新しいリンクで名前を入れ直してもらいます。"}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

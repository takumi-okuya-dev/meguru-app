// 受付の手伝い（主催者。/collect/events/:eventId/helpers。specs/collect/001-event-day-collection User Story 3、FR-070〜FR-073、tasks.md T051）。
// 受付用リンクを出し、QRとコピーで手伝う人に渡す。期限を変える・止める・出し直す。下に受付をしている人の表（端末の数を含む）。
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { formatJstShort } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { LinkPanel, type LinkApi, type LinkTexts } from "../components/LinkPanel";
import { collectApi } from "../lib/api";
import { receptionPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/** 受付用リンクの言葉。 */
const HELPER_LINK_TEXTS: LinkTexts = {
  createLabel: "受付用リンクを出す",
  stopTitle: "受付用リンクを止めますか？",
  stopBody: "手伝う人の画面は止まり、受付ができなくなります。手伝う人がした受付の記録は残ります。",
  stopped: "リンクを止めました。手伝う人の画面も止まります。",
  reissueTitle: "受付用リンクを出し直しますか？",
  reissueBody: "今のリンクとQRは使えなくなります。手伝う人には、新しいリンクで名前を入れ直してもらいます。",
};

/**
 * 受付の手伝いの画面。
 * @returns 画面
 */
export function HelpersPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const workers = useQuery({ queryKey: collectQueryKeys.workers(eventId), queryFn: () => collectApi.workers(eventId), refetchInterval: 30_000 });
  const linkApi = useMemo<LinkApi>(
    () => ({
      get: () => collectApi.link(eventId),
      create: () => collectApi.createLink(eventId),
      update: (expiresAt) => collectApi.updateLink(eventId, expiresAt),
      stop: () => collectApi.stopLink(eventId),
    }),
    [eventId],
  );

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
          <LinkPanel queryKey={collectQueryKeys.link(eventId)} api={linkApi} texts={HELPER_LINK_TEXTS}>
            <p className="text-sm text-muted-foreground">
              手伝う人はログインなしで、名前を入れるだけで受付ができます（名簿の編集・締めはできません）。会場で直接QRを見せるか、リンクを渡してください。
            </p>
          </LinkPanel>
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

    </>
  );
}

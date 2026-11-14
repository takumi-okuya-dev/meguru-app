// セルフ受付（主催者。/collect/events/:eventId/self。specs/collect/002-self-check-in User Story 3、FR-001〜FR-004、tasks.md T017）。
// セルフ受付のリンクを出し、QRを会場に貼るか見せる。期限を変える・止める・出し直す。下に、本人の申告・確かめ待ち・申し出の数。
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/shell";
import { LinkPanel, type LinkApi, type LinkTexts } from "../components/LinkPanel";
import { collectApi } from "../lib/api";
import { receptionPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/** セルフ受付のリンクの言葉。 */
const SELF_LINK_TEXTS: LinkTexts = {
  createLabel: "セルフ受付のQRを出す",
  stopTitle: "セルフ受付を止めますか？",
  stopBody: "参加者はQRから受付できなくなります。参加者がした本人の申告と申し出は残り、受付の画面で確かめられます。",
  stopped: "セルフ受付を止めました。",
  reissueTitle: "セルフ受付のQRを出し直しますか？",
  reissueBody: "今のQRとリンクは使えなくなります。会場に貼ったQRも新しいものに替えてください。",
};

/**
 * セルフ受付の画面。
 * @returns 画面
 */
export function SelfCheckInPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const linkApi = useMemo<LinkApi>(
    () => ({
      get: () => collectApi.selfLink(eventId),
      create: () => collectApi.createSelfLink(eventId),
      update: (expiresAt) => collectApi.updateSelfLink(eventId, expiresAt),
      stop: () => collectApi.stopSelfLink(eventId),
    }),
    [eventId],
  );
  // 数は受付の画面のスナップショットから（会場の共有にはつながず、15秒ごとに読み直す）
  const snap = useQuery({ queryKey: collectQueryKeys.selfCounts(eventId), queryFn: () => collectApi.reception(eventId), refetchInterval: 15_000 });
  const records = snap.data?.people.flatMap((p) => (p.record ? [p.record] : [])) ?? [];
  const selfCount = records.filter((r) => r.selfReported).length;

  return (
    <>
      <PageHeader
        title="セルフ受付"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={receptionPath(eventId)}>受付へ</Link>
          </Button>
        }
      />
      <PageBody className="space-y-8">
        {snap.data && <p className="truncate font-medium">{snap.data.event.name}</p>}
        <section className="space-y-3" aria-labelledby="self-link-title">
          <h2 id="self-link-title" className="font-medium">
            セルフ受付のQR
          </h2>
          <LinkPanel queryKey={collectQueryKeys.selfLink(eventId)} api={linkApi} texts={SELF_LINK_TEXTS}>
            <p className="text-sm text-muted-foreground">
              参加者はQRを読み、ログインなしで自分の名前か受付番号を入れて受付します。現金・PayPayは本人の申告なので「確かめ待ち」になり、受付の画面で「受け取った」を押すと確定します。参加者には、ほかの参加者の名前は見えません。
            </p>
          </LinkPanel>
        </section>

        <section className="space-y-3" aria-labelledby="self-count-title">
          <h2 id="self-count-title" className="font-medium">
            いまの数
          </h2>
          {snap.isPending ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted" aria-busy="true" />
          ) : snap.isError ? (
            <p className="text-sm text-muted-foreground">読めませんでした。</p>
          ) : (
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="セルフ受付の数">
              <div className="rounded-lg border bg-card px-3 py-2">
                <dt className="text-xs text-muted-foreground">本人の申告</dt>
                <dd className="text-base font-semibold tabular-nums">{selfCount}件</dd>
              </div>
              <div className="rounded-lg border bg-card px-3 py-2">
                <dt className="text-xs text-muted-foreground">確かめ待ち</dt>
                <dd className="text-base font-semibold tabular-nums">
                  {snap.data.stats.awaitingConfirmationCount}件・{yen(snap.data.stats.awaitingConfirmationAmount)}
                </dd>
              </div>
              <div className="rounded-lg border bg-card px-3 py-2">
                <dt className="text-xs text-muted-foreground">名簿にいない人の申し出</dt>
                <dd className="text-base font-semibold tabular-nums">{snap.data.selfRequests.length}件</dd>
              </div>
            </dl>
          )}
        </section>
      </PageBody>
    </>
  );
}

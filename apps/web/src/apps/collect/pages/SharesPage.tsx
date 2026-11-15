// つながった運営メンバーの画面（/collect/shares・/collect/shares/:eventId。specs/collect/003-revenue-sharing User Story 5、
// FR-053・FR-054、tasks.md T027）。集金管理の骨格（利用の許可の確かめ）の外に置き、読むだけで見せる。名簿・参加者の名前は出さない。
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { formatJstShort } from "@/lib/format";
import { DistributionTable, RevenueSummary } from "../components/sharing/DistributionTable";
import { collectApi } from "../lib/api";
import { sharePath, sharesPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";

/**
 * つながった人の画面の枠（集金管理の骨格の外なので、自分で見出しを持つ）。
 * @param props - title：見出し、back：戻る先、children：中身
 * @returns 枠
 */
function Frame({ title, back, children }: { title: string; back?: { to: string; label: string }; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-8">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ChevronLeftIcon className="size-4" /> {back.label}
        </Link>
      )}
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </main>
  );
}

/**
 * つながったイベントの一覧。
 * @returns 画面
 */
export function SharesPage() {
  const shares = useQuery({ queryKey: collectQueryKeys.shares, queryFn: collectApi.shares });
  if (shares.isPending) return <LoadingSkeleton />;
  if (shares.isLoadingError) return <ApiErrorScreen error={shares.error} onRetry={() => void shares.refetch()} />;
  const events = shares.data.events;
  return (
    <Frame title="運営メンバーのイベント" back={{ to: "/apps", label: "すべてのアプリ" }}>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ運営メンバーとしてつながったイベントはありません。主催者から届いた招待のリンクを開いてください。</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="運営メンバーのイベント">
          {events.map((e) => (
            <li key={e.eventId}>
              <Link to={sharePath(e.eventId)} className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatJstShort(e.startsAt)}・{e.memberName}として
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">{e.deficit ? "負担の目安" : "受け取る合計"}</div>
                  <div className="font-medium tabular-nums">{yen(e.total)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/**
 * つながったイベントの分配（読むだけ）。
 * @returns 画面
 */
export function ShareDetailPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const share = useQuery({ queryKey: collectQueryKeys.share(eventId), queryFn: () => collectApi.share(eventId) });
  if (share.isPending) return <LoadingSkeleton />;
  if (share.isLoadingError) return <ApiErrorScreen error={share.error} onRetry={() => void share.refetch()} />;
  const s = share.data;
  return (
    <Frame title={s.event.name} back={{ to: sharesPath(), label: "運営メンバーのイベント" }}>
      <p className="-mt-4 text-sm text-muted-foreground">{formatJstShort(s.event.startsAt)}・読むだけ（直すのは主催者です）</p>
      <section aria-labelledby="share-revenue" className="space-y-3">
        <h2 id="share-revenue" className="text-sm font-medium">
          売上と残る額
        </h2>
        <RevenueSummary snap={s} />
      </section>
      <section aria-labelledby="share-expenses" className="space-y-3">
        <h2 id="share-expenses" className="text-sm font-medium">
          経費
        </h2>
        {s.expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">経費はありません。</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm" aria-label="経費">
            {s.expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{e.name}</div>
                  {e.payer && <div className="truncate text-xs text-muted-foreground">立て替え：{e.payer.name}</div>}
                </div>
                <div className="tabular-nums">{yen(e.amount)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="share-distribution" className="space-y-3">
        <h2 id="share-distribution" className="text-sm font-medium">
          分配
        </h2>
        <DistributionTable snap={s} you={s.you} />
      </section>
    </Frame>
  );
}

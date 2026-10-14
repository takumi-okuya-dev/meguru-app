// パフォーマンスの画面（specs/006-performance-feedback contracts/ui-routes.md、FR-011〜FR-031）。
// 上から：上部バー（最終更新・CSV）→ 案内 → 説明 → 基準値 → タブ → 低調のタブの説明 → 投稿のカード。
import {
  PERFORMANCE_MESSAGES,
  type FeedbackResponse,
  type PerformanceItem,
  type PerformancePage as PerformancePageData,
  type PerformanceTab,
} from "@threads-grower/shared";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ChartColumnIcon, CheckIcon, InfoIcon } from "lucide-react";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { PLAN_CHANGE_CONTACT } from "@/components/GrowerRequiredNotice";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { BaselineCard } from "@/components/performance/BaselineCard";
import { CsvExportMenu } from "@/components/performance/CsvExportMenu";
import { FeedbackEditor } from "@/components/performance/FeedbackEditor";
import { InsightsDeniedBanner } from "@/components/performance/InsightsDeniedBanner";
import { PerformanceCard } from "@/components/performance/PerformanceCard";
import { PerformanceTabs } from "@/components/performance/PerformanceTabs";
import { usePerformance, usePerformanceTab } from "@/components/performance/use-performance";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { formatJstShort } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { isGrowerRequired } from "@/lib/save-error";
import { useCurrentAccount } from "@/pages/account-layout";

/**
 * パフォーマンスの画面。
 * @returns パフォーマンスの画面
 */
export function PerformancePage() {
  const account = useCurrentAccount();
  const { tab, setTab } = usePerformanceTab();
  const query = usePerformance(account.id, tab);
  const queryClient = useQueryClient();

  // 保存した項目を一覧に入れ、次のプロンプトに入る印を合わせる（繰り上がり。FR-022）
  const onSaved = (res: FeedbackResponse) => {
    const inPrompt = new Set(res.promptIds);
    queryClient.setQueryData<InfiniteData<PerformancePageData>>(queryKeys.performance(account.id, tab), (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((it) => {
                const next = it.id === res.item.id ? res.item : it;
                return next.feedback ? { ...next, feedback: { ...next.feedback, inNextPrompt: inPrompt.has(next.id) } } : next;
              }),
            })),
          }
        : data,
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(account.id) });
  };

  if (query.isError && isGrowerRequired(query.error)) {
    return (
      <>
        <PageHeader title="パフォーマンス" />
        <PageBody>
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ChartColumnIcon className="size-6" aria-hidden="true" />
            </span>
            <h2 className="text-xl font-semibold">{PERFORMANCE_MESSAGES.growerRequiredTitle}</h2>
            <p className="text-muted-foreground">{PERFORMANCE_MESSAGES.growerRequiredBody}</p>
            <p className="text-sm text-muted-foreground">{PLAN_CHANGE_CONTACT}</p>
          </div>
        </PageBody>
      </>
    );
  }

  const pages = query.data?.pages ?? [];
  const summary = pages.at(-1)?.summary;
  const items: PerformanceItem[] = pages.flatMap((p) => p.items);

  return (
    <>
      <PageHeader
        title="パフォーマンス"
        actions={
          summary ? (
            <>
              {summary.lastFetchedAt && (
                <span className="hidden text-sm text-muted-foreground md:inline">
                  反応数の最終更新 {formatJstShort(summary.lastFetchedAt)}
                </span>
              )}
              <CsvExportMenu accountId={account.id} username={account.username ?? account.name} />
            </>
          ) : null
        }
      />
      <PageBody className="space-y-5">
        {query.isError ? (
          <ApiErrorScreen error={query.error} onRetry={() => void query.refetch()} />
        ) : !summary ? (
          <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        ) : (
          <>
            {summary.insightsDenied && <InsightsDeniedBanner accountId={account.id} />}
            <p className="text-muted-foreground">
              投稿ごとの反応数と、このアカウントの基準値と比べた判定です。反応数は投稿の24時間後から取り込み、約7日後に値が確定したら判定します。
            </p>
            <BaselineCard summary={summary} />
            {summary.lastFetchedAt && (
              <p className="text-xs text-muted-foreground md:hidden">反応数の最終更新 {formatJstShort(summary.lastFetchedAt)}</p>
            )}
            <Tabs value={tab} onValueChange={(v) => setTab(v as PerformanceTab)}>
              <PerformanceTabs counts={summary.counts} />
            </Tabs>
            {tab === "poor" && (
              <div className="flex items-start gap-3 rounded-2xl border bg-muted/40 px-4 py-3.5 text-sm">
                <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex flex-col gap-1">
                  <span>
                    閲覧数が基準値の半分以下だった投稿は、<strong>新しい順に5件まで</strong>
                    次のプロンプトに「反応が低かった投稿」として入ります。傾向メモを書くと、本文と一緒に入ります。
                  </span>
                  <span className="text-muted-foreground">
                    入れたくない投稿は「プロンプトに入れる」を外してください。外すと次の投稿が繰り上がります。
                  </span>
                </div>
              </div>
            )}
            {items.length === 0 ? (
              <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                {tab === "all"
                  ? "まだ投稿はありません。自動投稿した投稿の反応数が、ここに出ます"
                  : "当てはまる投稿はありません"}
              </p>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <PerformanceCard
                    key={item.id}
                    item={item}
                    headerExtra={
                      tab === "all" && item.feedback?.inNextPrompt ? (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <CheckIcon className="size-3.5" aria-hidden="true" />
                          次のプロンプトに入ります
                        </span>
                      ) : null
                    }
                  >
                    {item.feedback && tab === "poor" && (
                      <FeedbackEditor accountId={account.id} item={item} onSaved={onSaved} />
                    )}
                    {item.feedback && tab !== "poor" && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">
                          {item.feedback.memo
                            ? `傾向メモ：${item.feedback.memo}`
                            : item.feedback.includeInPrompt
                              ? "傾向メモはまだありません"
                              : "プロンプトから外しています"}
                        </span>
                        <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => setTab("poor")}>
                          改善メモを開く
                        </Button>
                      </div>
                    )}
                  </PerformanceCard>
                ))}
              </ul>
            )}
            {query.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {query.isFetchingNextPage ? "読み込み中…" : "さらに表示する"}
                </Button>
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

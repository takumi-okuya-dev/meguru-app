// 解析（/threads/accounts/:accountId/analysis。specs/022-algorithm-analysis contracts/ui-routes.md、モック https://claude.ai/artifact/5GK8yF32kwsAqPVU1SaT8A ）。
// 計算はAPI（shared の analyzePosts）で行い、画面は出すだけ。説明は閉じたトグルに置く（FR-064）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalysisResponse, AnalysisScope } from "@meguru/shared";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { BucketTable } from "@/apps/threads/components/analysis/BucketTable";
import { ClassifyDialog } from "@/apps/threads/components/analysis/ClassifyDialog";
import { ContentCard } from "@/apps/threads/components/analysis/ContentCard";
import { FeatureTable } from "@/apps/threads/components/analysis/FeatureTable";
import { RecommendedCard } from "@/apps/threads/components/analysis/RecommendedCard";
import { ScheduleHint } from "@/apps/threads/components/analysis/ScheduleHint";
import { TrendCard } from "@/apps/threads/components/analysis/TrendCard";
import { PageBody, PageHeader } from "@/shell";
import { HelpToggle } from "@/components/HelpToggle";
import { describeError } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/apps/threads/pages/account-layout";

const HELP = [
  "確定した投稿（投稿から約7日）だけで見ています",
  "中央値（真ん中の値）で比べています",
  "表示の順位はThreadsから取れないので、フォロワー数と閲覧から推し量っています",
  "傾向は相関で、原因とは限りません。件数が少ないうちは偶然の差が出ます",
  "宣伝の投稿は、本文に宣伝内容のタイトルかURLがある投稿です",
] as const;

const SCOPES: [AnalysisScope, string][] = [
  ["all", "すべて"],
  ["regular", "ふだんの投稿"],
];

/**
 * 区切りの節（見出しと表）。
 * @param props - id：見出しのid、title：見出し、children：中身
 * @returns 節
 */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2.5">
      <h2 id={id} className="font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * 解析の画面。
 * @returns 画面
 */
export function AnalysisPage() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const scope: AnalysisScope = params.get("scope") === "regular" ? "regular" : "all";
  const [classifying, setClassifying] = useState(false);
  const query = useQuery({
    queryKey: threadsQueryKeys.analysis(account.id, scope),
    queryFn: () => threadsApi.analysis(account.id, scope),
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) =>
      threadsApi.patchAnalysisSettings(account.id, { expectedVersion: query.data?.settings.version ?? null, trendsInPrompt: on }),
    onSuccess: (res) => {
      // 続けて切り替えても古い版を送らないよう、保存した設定をすぐ入れる
      queryClient.setQueryData<AnalysisResponse>(threadsQueryKeys.analysis(account.id, scope), (d) => (d ? { ...d, settings: res.settings } : d));
      void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.analysisAll(account.id) });
      void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.promptAll(account.id) });
    },
    onError: (err) => toast.error(describeError(err)),
  });

  const d = query.data;
  return (
    <>
      <PageHeader
        title="解析"
        actions={
          d ? <span className="hidden text-sm text-muted-foreground md:inline">{`直近${d.period.days}日・確定した投稿 ${d.totals.confirmed}件`}</span> : null
        }
      />
      <PageBody className="max-w-5xl space-y-6">
        {query.isError ? (
          <ApiErrorScreen error={query.error} onRetry={() => void query.refetch()} />
        ) : !d ? (
          <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground md:hidden">
                  {`直近${d.period.days}日・確定した投稿 ${d.totals.confirmed}件`}
                </p>
                <div role="radiogroup" aria-label="見る投稿" className="flex gap-1.5">
                  {SCOPES.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={scope === key}
                      onClick={() => setParams(key === "all" ? {} : { scope: key }, { replace: true })}
                      className={cn(
                        "h-9 rounded-full border px-3.5 text-[13px]",
                        scope === key ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-accent",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <HelpToggle label="この画面の見方" points={HELP} />
            </div>

            {d.needMore !== null ? (
              <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                {`あと${d.needMore}件たまると見られます`}
              </p>
            ) : (
              <>
                <TrendCard
                  trends={d.trends}
                  trendsInPrompt={d.settings.trendsInPrompt}
                  canEdit={d.canEdit}
                  saving={toggle.isPending}
                  onToggle={(on) => toggle.mutate(on)}
                />
                <RecommendedCard recommended={d.recommended} withFollowers={d.totals.withFollowers} confirmed={d.totals.confirmed} />
                <Section id="analysis-time" title="時間帯">
                  <BucketTable
                    label="時間帯"
                    rows={d.time}
                    bars
                    footer={<ScheduleHint accountId={account.id} slotTimes={d.schedule.slotTimes} trends={d.trends} />}
                  />
                </Section>
                <div className="grid gap-6 md:grid-cols-2">
                  <Section id="analysis-day" title="曜日">
                    <BucketTable label="曜日" rows={d.day} />
                  </Section>
                  <Section id="analysis-length" title="文字数">
                    <BucketTable label="文字数" rows={d.length} />
                  </Section>
                </div>
                <Section id="analysis-features" title="本文の特徴">
                  <FeatureTable rows={d.features} />
                </Section>
                <ContentCard data={d} canEdit={d.canEdit} onClassify={() => setClassifying(true)} />
              </>
            )}
          </>
        )}
      </PageBody>
      {classifying && d && (
        <ClassifyDialog accountId={account.id} settingsVersion={d.settings.version} onRequestClose={() => setClassifying(false)} />
      )}
    </>
  );
}

// 運用状況（/teams/:teamId/status。specs/020-team-monitoring contracts/ui-routes.md 2、モック https://claude.ai/artifact/ESSqiqhGna9qZ56YFBUKg1 ）。
// 管理者はチームのすべて、編集者は担当のアカウントとそのオーナーだけ（範囲はAPIが決める。画面は出すだけで、数えない・判定しない）。
// スマートフォンは行を縦に積み、パソコンは列にそろえる（横にスクロールさせない。FR-032）。
import { useQuery } from "@tanstack/react-query";
import { errorMessage, formatRatio, type TeamStatus } from "@meguru/shared";
import { ArrowLeftIcon, TrendingDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { AccountAvatar } from "@/components/AccountAvatar";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { HelpToggle } from "@/components/team/HelpToggle";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { formatDaysAgoJst } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { NotFound } from "@/pages/not-found";

const ROLE_NAMES = { admin: "管理者", member: "メンバー", editor: "編集者" } as const;

const HELP = [
  "7日より長く動きがないと「止まっている」",
  "伸びは、直近30日の閲覧数を前の30日と比べた値",
  "×0.8以下で「伸びていない」",
  "見えるのは数と日付だけ。投稿の本文や戦略は見えません",
] as const;

// パソコンの列（見出しと行で同じ並び）
const PEOPLE_COLS =
  "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center md:gap-3";
const ACCOUNT_COLS =
  "md:grid md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)] md:items-center md:gap-3";

/**
 * 「止まっている」の印（注意の色。今ある見た目）。
 * @returns 印
 */
function StoppedBadge() {
  return (
    <span className="shrink-0 self-start rounded-full bg-warning-bg px-2 text-[11px] font-medium text-warning md:self-center">
      止まっている
    </span>
  );
}

/**
 * スマートフォンでだけ前に付ける見出し（パソコンは列の見出しがある）。
 * @param props - label：見出し、children：値
 * @returns 値
 */
function Cell({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <span className="text-[13px] text-muted-foreground md:text-sm md:text-foreground">
      {label && <span className="md:hidden">{label}：</span>}
      <span>{children}</span>
    </span>
  );
}

/**
 * 伸び（specs/020 data-model.md の growth）。低調はパフォーマンスの低調と同じ色と矢印。
 * @param props - growth：伸び
 * @returns 伸びの表示
 */
function Growth({ growth }: { growth: TeamStatus["accounts"][number]["growth"] }) {
  if (growth.state === "metrics_off")
    return <span className="text-[13px] text-muted-foreground">取り込んでいません</span>;
  if (growth.state === "insufficient")
    return <span className="text-[13px] text-muted-foreground">まだ判定できません</span>;
  const ratio = `×${formatRatio(growth.ratio)}`;
  if (growth.state === "ok") {
    return (
      <span className="rounded-full bg-muted px-2 text-[11px] font-semibold text-muted-foreground">
        {ratio}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5 rounded-full bg-perf-poor-bg px-2 text-[11px] font-semibold text-perf-poor-fg">
        <TrendingDownIcon className="size-3" aria-hidden="true" />
        {ratio}
      </span>
      <span className="text-[13px] font-medium text-perf-poor-fg">伸びていない</span>
    </span>
  );
}

/**
 * 最後に動いた日の表示。
 * @param p - 人の行
 * @returns 「今日」「10/26（9日前）」「まだありません」「90日以内にありません」
 */
function lastActiveLabel(p: TeamStatus["people"][number]): string {
  if (p.lastActiveAt) return formatDaysAgoJst(p.lastActiveAt);
  return p.retentionLimited ? "90日以内にありません" : "まだありません";
}

/**
 * 運用状況の画面。
 * @returns 画面
 */
export function TeamStatusPage() {
  const { teamId = "" } = useParams<{ teamId: string }>();
  const team = useQuery({ queryKey: queryKeys.team(teamId), queryFn: () => api.getTeam(teamId) });
  const status = useQuery({
    queryKey: queryKeys.teamStatus(teamId),
    queryFn: () => api.teamStatus(teamId),
  });
  const back = (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="size-10 md:size-9"
      aria-label="チームの画面に戻る"
    >
      <Link to={`/teams/${teamId}`}>
        <ArrowLeftIcon className="size-5" />
      </Link>
    </Button>
  );

  if (status.isPending) return <LoadingSkeleton />;
  if (status.isError) {
    const code = status.error instanceof ApiError ? status.error.code : null;
    if (code === "TEAM_NOT_FOUND")
      return <NotFound message={errorMessage("TEAM_NOT_FOUND").message} />;
    if (code === "ROLE_FORBIDDEN") {
      return (
        <>
          <PageHeader title="運用状況" actions={back} />
          <PageBody>
            <p className="text-sm text-muted-foreground">
              この画面は、管理者と担当の編集者だけが見られます。
            </p>
          </PageBody>
        </>
      );
    }
    return <ApiErrorScreen error={status.error} onRetry={() => void status.refetch()} />;
  }
  const s = status.data;
  const teamName = team.data?.name ?? "";

  return (
    <>
      <PageHeader title="運用状況" actions={back} />
      <PageBody className="max-w-5xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {teamName}
            {teamName && " · "}
            {s.scope === "all"
              ? "見えるのは管理者と担当の編集者だけ"
              : "あなたの担当のアカウントだけ"}
          </p>
          <HelpToggle label="見方" points={HELP} />
        </div>

        <section aria-labelledby="status-people" className="space-y-2.5">
          <h2 id="status-people" className="font-medium">
            人
          </h2>
          <div className="overflow-hidden rounded-2xl border">
            <div
              aria-hidden="true"
              className={`hidden border-b bg-muted/60 px-4 py-2.5 text-xs text-muted-foreground ${PEOPLE_COLS}`}
            >
              <span>名前</span>
              <span>ロール</span>
              <span>最後に動いた日</span>
              <span>7日の動き</span>
              <span />
            </div>
            <ul aria-label="人の運用状況" className="divide-y">
              {s.people.map((p) => (
                <li key={p.userId} className={`flex flex-col gap-1 px-4 py-3 ${PEOPLE_COLS}`}>
                  {/* パソコンでは中の要素が列になる（md:contents）。印は order で最後の列へ */}
                  <span className="flex items-center gap-2 md:contents">
                    <span className="min-w-0 flex-1 font-medium">
                      {p.isMe ? `${p.name}（あなた）` : p.name}
                      <span className="ml-1.5 text-[13px] font-normal text-muted-foreground md:hidden">
                        {ROLE_NAMES[p.role]}
                      </span>
                    </span>
                    <span className="hidden text-sm text-muted-foreground md:inline">
                      {ROLE_NAMES[p.role]}
                    </span>
                    <span className="md:order-last">{p.stopped && <StoppedBadge />}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-1 md:contents">
                    <Cell label="最後に動いた日">{lastActiveLabel(p)}</Cell>
                    <span
                      className="text-[13px] text-muted-foreground md:hidden"
                      aria-hidden="true"
                    >
                      ·
                    </span>
                    <Cell>{`7日で${p.activeCount7d}回`}</Cell>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="status-accounts" className="space-y-2.5">
          <h2 id="status-accounts" className="font-medium">
            アカウント
          </h2>
          <div className="overflow-hidden rounded-2xl border">
            <div
              aria-hidden="true"
              className={`hidden border-b bg-muted/60 px-4 py-2.5 text-xs text-muted-foreground ${ACCOUNT_COLS}`}
            >
              <span>アカウント</span>
              <span>最後の投稿</span>
              <span>7日の投稿</span>
              <span>承認済み</span>
              <span>要確認</span>
              <span>伸び（前の30日比）</span>
            </div>
            <ul aria-label="アカウントの運用状況" className="divide-y">
              {s.accounts.map((a) => (
                <li key={a.accountId} className={`flex flex-col gap-1.5 px-4 py-3 ${ACCOUNT_COLS}`}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <AccountAvatar account={a} className="size-8" />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.owner.isMe ? "あなたのアカウント" : `${a.owner.name}さんのアカウント`}
                      </span>
                      {a.connection === "disconnected" && (
                        <span className="text-xs text-warning">接続が切れています</span>
                      )}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-1 md:contents">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Cell label="最後の投稿">
                        {a.lastPostedAt ? formatDaysAgoJst(a.lastPostedAt) : "まだありません"}
                      </Cell>
                      {a.stopped && <StoppedBadge />}
                    </span>
                    <span
                      className="text-[13px] text-muted-foreground md:hidden"
                      aria-hidden="true"
                    >
                      ·
                    </span>
                    <Cell>{`7日で${a.postCount7d}件`}</Cell>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-1 md:contents">
                    <Cell>{`承認済み ${a.approvedCount}件`}</Cell>
                    <span
                      className="text-[13px] text-muted-foreground md:hidden"
                      aria-hidden="true"
                    >
                      ·
                    </span>
                    <Cell>{`要確認 ${a.needsReviewCount}件`}</Cell>
                    <span
                      className="text-[13px] text-muted-foreground md:hidden"
                      aria-hidden="true"
                    >
                      ·
                    </span>
                    <Growth growth={a.growth} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </PageBody>
    </>
  );
}

// 見せてもらっているアカウント（/teams/:teamId/accounts/:accountId。specs/011-team-revision contracts/ui-routes.md
// 「見せてもらっているアカウント」、US3、FR-031）。投稿ストックと戦略を読むだけで、操作のボタンは出さない。
// パフォーマンス・設定・操作の記録へのリンクも出さない。開けなくなったら知らせてチームの画面へ移す。
import { useQuery } from "@tanstack/react-query";
import { STRATEGY_FIELDS, type PostDraft } from "@meguru/shared";
import { EyeIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { AccountAvatar } from "@/apps/threads/components/AccountAvatar";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";

type StockFilter = "approved" | "published" | "needsReview";
const FILTERS: { key: StockFilter; label: string }[] = [
  { key: "approved", label: "承認済み" },
  { key: "published", label: "投稿済み" },
  { key: "needsReview", label: "要確認" },
];

/**
 * 開けない（見せるのをやめた・チームを抜けた）ときのエラーか。
 * @param err - エラー
 * @returns 開けないなら true
 */
const isLost = (err: unknown) =>
  err instanceof ApiError && (err.code === "ACCOUNT_NOT_FOUND" || err.code === "ROLE_FORBIDDEN");

/** 見られなくなったときの文言（specs/008 FR-046 と同じ考え方）。 */
const LOST_MESSAGE = "このアカウントを見られなくなりました";

/**
 * 子の問い合わせで見られなくなったと分かったら、親に知らせる。
 * @param error - 問い合わせのエラー
 * @param onLost - 知らせる関数
 */
function useReportLost(error: unknown, onLost: () => void) {
  useEffect(() => {
    if (isLost(error)) onLost();
  }, [error, onLost]);
}

/**
 * 一部の読み込みに失敗したときの案内（「まだありません」と取り違えないよう、失敗と再読み込みを出す。PR #14 のCodexレビュー）。
 * @param props - onRetry：読み込み直す
 * @returns 案内
 */
function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm"
    >
      <span className="flex-1">読み込めませんでした。</span>
      <Button variant="outline" size="sm" className="rounded-full" onClick={onRetry}>
        再読み込み
      </Button>
    </p>
  );
}

/**
 * 投稿ストックのタブ。
 * @param props - accountId：アカウント、onLost：見られなくなった
 * @returns タブの中身
 */
function StockTab({ accountId, onLost }: { accountId: string; onLost: () => void }) {
  const [filter, setFilter] = useState<StockFilter>("approved");
  const drafts = useQuery({
    queryKey: queryKeys.postDrafts(accountId),
    queryFn: () => api.listPostDrafts(accountId),
  });
  const published = useQuery({
    queryKey: queryKeys.published(accountId),
    queryFn: () => api.listPublished(accountId),
    enabled: filter === "published",
  });
  useReportLost(drafts.error ?? published.error, onLost);
  if (drafts.isPending) return <LoadingSkeleton />;
  if (drafts.isError)
    return isLost(drafts.error) ? null : (
      <ApiErrorScreen error={drafts.error} onRetry={() => void drafts.refetch()} />
    );
  const items: { id: string; body: string; note: string }[] =
    filter === "published"
      ? (published.data?.items ?? []).map((p) => ({ id: p.id, body: p.body, note: "投稿済み" }))
      : (filter === "approved" ? drafts.data.approved : drafts.data.needsReview).map(
          (d: PostDraft, i) => ({
            id: d.id,
            body: d.body,
            note: filter === "approved" ? `承認済み · 次の投稿の順 ${i + 1}番目` : "要確認",
          }),
        );
  return (
    <section aria-label="投稿の案" className="space-y-3">
      <div role="group" aria-label="状態で絞る" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "h-9 rounded-full px-3.5 text-[13px]",
              filter === f.key ? "bg-foreground text-background" : "bg-muted text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {filter === "published" && published.isPending ? (
        <LoadingSkeleton />
      ) : filter === "published" && published.isError ? (
        isLost(published.error) ? null : (
          <LoadFailed onRetry={() => void published.refetch()} />
        )
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">この状態の投稿はありません。</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((d) => (
            <li key={d.id} className="space-y-2 rounded-2xl border p-4">
              <p className="text-sm whitespace-pre-wrap">{d.body}</p>
              <span className="text-xs text-muted-foreground">{d.note}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        読むだけなので、承認・編集・削除・貼り付けのボタンは出ません。パフォーマンスと設定は見られません。
      </p>
    </section>
  );
}

/**
 * 戦略のタブ（課題・宣伝内容・リサーチを読むだけ）。
 * @param props - accountId：アカウント、onLost：見られなくなった
 * @returns タブの中身
 */
function StrategyTab({ accountId, onLost }: { accountId: string; onLost: () => void }) {
  const strategy = useQuery({
    queryKey: queryKeys.strategy(accountId),
    queryFn: () => api.getStrategy(accountId),
  });
  const promotions = useQuery({
    queryKey: queryKeys.promotions(accountId),
    queryFn: () => api.listPromotions(accountId),
  });
  const references = useQuery({
    queryKey: queryKeys.referencePosts(accountId),
    queryFn: () => api.listReferencePosts(accountId),
  });
  const keywords = useQuery({
    queryKey: queryKeys.researchKeywords(accountId),
    queryFn: () => api.listResearchKeywords(accountId),
  });
  useReportLost(strategy.error ?? promotions.error ?? references.error ?? keywords.error, onLost);
  if (strategy.isPending) return <LoadingSkeleton />;
  if (strategy.isError)
    return isLost(strategy.error) ? null : (
      <ApiErrorScreen error={strategy.error} onRetry={() => void strategy.refetch()} />
    );
  const filled = STRATEGY_FIELDS.filter(
    (f) =>
      f.kind === "text" && String(strategy.data[f.key as keyof typeof strategy.data] ?? "").trim(),
  );
  return (
    <div className="space-y-6">
      <section aria-labelledby="s-strategy" className="space-y-2.5">
        <h2 id="s-strategy" className="font-medium">
          課題
        </h2>
        {filled.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ書かれていません。</p>
        ) : (
          <dl className="divide-y rounded-2xl border">
            {filled.map((f) => (
              <div key={f.key} className="space-y-1 px-4 py-3">
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="text-sm whitespace-pre-wrap">
                  {String(strategy.data[f.key as keyof typeof strategy.data])}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section aria-labelledby="s-promotions" className="space-y-2.5">
        <h2 id="s-promotions" className="font-medium">
          宣伝内容
        </h2>
        {promotions.isError ? (
          isLost(promotions.error) ? null : (
            <LoadFailed onRetry={() => void promotions.refetch()} />
          )
        ) : promotions.isPending ? (
          <LoadingSkeleton />
        ) : promotions.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだありません。</p>
        ) : (
          <ul className="space-y-2">
            {promotions.data!.items.map((p) => (
              <li key={p.id} className="space-y-1 rounded-2xl border p-4">
                <div className="font-medium">{p.title}</div>
                <p className="text-sm whitespace-pre-wrap text-foreground/80">{p.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="s-research" className="space-y-2.5">
        <h2 id="s-research" className="font-medium">
          リサーチ
        </h2>
        {(keywords.isError && !isLost(keywords.error)) ||
        (references.isError && !isLost(references.error)) ? (
          <LoadFailed
            onRetry={() => {
              void keywords.refetch();
              void references.refetch();
            }}
          />
        ) : keywords.isPending || references.isPending ? (
          <LoadingSkeleton />
        ) : (
          <>
            {(keywords.data?.items ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {keywords.data!.items.map((k) => (
                  <span key={k.id} className="rounded-full bg-muted px-3 py-1 text-[13px]">
                    {k.keyword}
                  </span>
                ))}
              </div>
            )}
            {(references.data?.items ?? []).length === 0 &&
            (keywords.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">まだありません。</p>
            ) : (
              <ul className="space-y-2">
                {(references.data?.items ?? []).map((r) => (
                  <li key={r.id} className="space-y-1 rounded-2xl border p-4">
                    <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                    {r.whyGood && (
                      <p className="text-xs text-muted-foreground">良いところ：{r.whyGood}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px] text-foreground/80">
          参考にしたい投稿があれば、自分のアカウントの「リサーチ」に手で書き写してください（ほかのアカウントの内容を自動で取り込むことはしません）。
        </p>
      </section>
    </div>
  );
}

/**
 * 見せてもらっているアカウントの画面。
 * @returns 画面
 */
export function TeamSharedAccountPage() {
  const { teamId = "", accountId = "" } = useParams<{ teamId: string; accountId: string }>();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "strategy" ? "strategy" : "stock";
  const navigate = useNavigate();
  const access = useQuery({
    queryKey: queryKeys.access(accountId),
    queryFn: () => api.accountAccess(accountId),
  });
  const account = useQuery({
    queryKey: queryKeys.account(accountId),
    queryFn: () => api.account(accountId),
  });
  const team = useQuery({ queryKey: queryKeys.team(teamId), queryFn: () => api.getTeam(teamId) });
  const [childLost, setChildLost] = useState(false);
  const onLost = useCallback(() => setChildLost(true), []);
  const lost =
    childLost ||
    [access.error, account.error].some(isLost) ||
    Boolean(access.data && access.data.team?.id !== teamId);

  useEffect(() => {
    if (!lost) return;
    toast.error(LOST_MESSAGE, { id: "shared-account-lost" });
    void navigate(`/teams/${teamId}`, { replace: true });
  }, [lost, navigate, teamId]);

  if (lost) return null;
  if (access.isPending || account.isPending) return <LoadingSkeleton />;
  if (access.isError)
    return <ApiErrorScreen error={access.error} onRetry={() => void access.refetch()} />;
  if (account.isError)
    return <ApiErrorScreen error={account.error} onRetry={() => void account.refetch()} />;
  // オーナー・担当の人は、ふつうのAccountの画面で開く
  if (access.data.relation !== "shared_viewer")
    return <Navigate to={`/accounts/${accountId}`} replace />;
  const a = account.data;
  const owner = access.data.owner.name;
  // オーナーが使えないまとまりのタブは出さず、そのAPIも読まない（specs/019 FR-012・FR-004）。
  // 投稿ストックは自動投稿、戦略は戦略のまとまり
  const tabs = (
    [
      ["stock", "投稿ストック", "autopost"],
      ["strategy", "戦略", "strategy"],
    ] as const
  ).filter(([, , feature]) => access.data.features.includes(feature));
  const shown = tabs.some(([key]) => key === tab) ? tab : tabs[0]?.[0];

  return (
    <div className="flex min-h-svh flex-col">
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 border-b bg-muted px-4 py-2.5 text-sm md:px-6"
      >
        <EyeIcon aria-hidden="true" className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1">
          {owner}さんのアカウントを見ています（読むだけ）{team.data ? ` · ${team.data.name}` : ""}
        </span>
        <Button asChild variant="outline" className="h-9 rounded-full bg-background">
          <Link to={`/teams/${teamId}`}>チームに戻る</Link>
        </Button>
      </div>
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-5 md:px-6">
        <AccountAvatar account={a} className="size-10" />
        <span className="flex min-w-0 flex-col leading-tight">
          <h1 className="truncate text-[17px] font-semibold">{a.name}</h1>
          <span className="truncate text-xs text-muted-foreground">
            {a.username ? `@${a.username}` : "未接続"} · オーナー {owner}
          </span>
        </span>
      </header>
      <nav
        aria-label="見る内容"
        className="mx-auto mt-3 flex w-full max-w-3xl gap-1 border-b px-4 md:px-6"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-current={shown === key ? "page" : undefined}
            onClick={() =>
              setParams(key === "strategy" ? { tab: "strategy" } : {}, { replace: true })
            }
            className={cn(
              "h-10 border-b-2 px-3.5 text-sm",
              shown === key
                ? "border-foreground font-semibold"
                : "border-transparent text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 md:px-6">
        {shown === "stock" ? (
          <StockTab accountId={accountId} onLost={onLost} />
        ) : shown === "strategy" ? (
          <StrategyTab accountId={accountId} onLost={onLost} />
        ) : (
          <p className="text-sm text-muted-foreground">見られる内容はありません。</p>
        )}
      </main>
    </div>
  );
}

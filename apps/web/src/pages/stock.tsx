// 投稿ストックの画面（specs/003 US1〜US3・specs/004 US1〜US5、contracts/ui-routes.md「投稿ストックの画面」、docs/ui-design.md 型C）。
// 上から：状態のタブ（要確認／承認済み／却下）と下書きの一覧 → 選んでいる間は画面下部に固定の選択のバー。
// プロンプトのカードと貼り付け欄は「投稿をつくる」の画面に移した（specs/014 US15、FR-163）。
// 下書きの削除は確認を求めず、トーストの「元に戻す」で取り消せる（003 Clarifications 2026-10-04）。
// 承認・却下・要確認に戻すも、トーストの「元に戻す」で取り消せる（004 FR-008）。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SIMILARITY_THRESHOLD,
  checkPublishable,
  type PostDraft,
  type PublishCheck,
} from "@threads-grower/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { AutoPostNotices } from "@/components/AutoPostNotices";
import { PublishedList } from "@/components/stock/PublishedList";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { DraftCard } from "@/components/stock/DraftCard";
import { DraftEditDialog } from "@/components/stock/DraftEditDialog";
import {
  HighlightedBody,
  LabelRow,
  NgWordLabel,
  PolicyCautionLabels,
  SimilarityLabel,
  highlightsOf,
} from "@/components/stock/DraftLabels";
import { DraftList } from "@/components/stock/DraftList";
import { SelectionBar } from "@/components/stock/SelectionBar";
import { useAccountAccess } from "@/lib/use-account-access";
import { RejectDialog } from "@/components/stock/RejectDialog";
import { REOPENED_BY_EDIT } from "@/components/stock/messages";
import { PolicyConfirmDialog } from "@/components/stock/PolicyConfirmDialog";
import { BulkApproveDialog } from "@/components/stock/BulkApproveDialog";
import { StatusTabs, useStatusTab, type StockTab } from "@/components/stock/StatusTabs";
import { useDeferredDelete } from "@/components/stock/use-deferred-delete";
import { useReview, type ReviewOptions } from "@/components/stock/use-review";
import { useSimilarities } from "@/components/stock/use-similarities";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon, SquarePenIcon } from "lucide-react";
import { api, describeError } from "@/lib/api-client";
import { formatRelativeJst } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { useCurrentAccount } from "@/pages/account-layout";

const TAB_VALUES: StockTab[] = ["needs_review", "approved", "rejected", "published"];

/**
 * 下書きを表示するタブ。投稿の処理中は承認済みのタブに出す（005）。
 * @param d - 下書き
 * @returns タブ
 */
function tabOf(d: PostDraft): StockTab {
  return d.status === "needs_review" || d.status === "rejected" ? d.status : "approved";
}

/**
 * 投稿ストックの画面。下書きの確認・修正・削除・承認・却下と、投稿済みの一覧。
 * 同じURLのままAccountを切り替えたときに、選択やプロンプトのカードの状態（使えない表示など）を持ち越さないよう、
 * Accountごとに作り直す（PR #5 のCodexレビュー）。
 * @returns 投稿ストックの画面
 */
export function StockPage() {
  const account = useCurrentAccount();
  return <StockPageContent key={account.id} />;
}

/**
 * 投稿ストックの画面の中身（1つのAccount分）。
 * @returns 投稿ストックの画面
 */
function StockPageContent() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const drafts = useQuery({
    queryKey: queryKeys.postDrafts(account.id),
    queryFn: () => api.listPostDrafts(account.id),
  });
  const { tab, setTab } = useStatusTab();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<PostDraft | null>(null);
  const [rejecting, setRejecting] = useState<PostDraft[] | null>(null);
  const [confirming, setConfirming] = useState<{
    targets: PostDraft[];
    cautious: PostDraft[];
  } | null>(null);
  // まとめて承認の確認（FR-004b）で待っている、選んだ下書き
  const [bulkApproving, setBulkApproving] = useState<PostDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { hidden, remove } = useDeferredDelete(account.id);
  const { review } = useReview(account.id);
  // 承認の操作ができるか（specs/008 FR-041）。読み込み中は出さない
  const { access, can } = useAccountAccess(account.id);
  const canReview = can("review");
  const data = drafts.data;

  // 削除して確定を待っている下書きは、一覧から隠す
  const lists = useMemo<Record<StockTab, PostDraft[]>>(
    () => ({
      needs_review: (data?.needsReview ?? []).filter((d) => !hidden.has(d.id)),
      approved: data?.approved ?? [],
      published: [],
      rejected: (data?.rejected ?? []).filter((d) => !hidden.has(d.id)),
    }),
    [data, hidden],
  );
  const counts = useMemo(
    () =>
      data && {
        needsReview:
          data.counts.needsReview - (data.needsReview.length - lists.needs_review.length),
        approved: data.counts.approved,
        rejected: data.counts.rejected - (data.rejected.length - lists.rejected.length),
        published: data.counts.published,
        publishFailed: data.counts.publishFailed,
      },
    [data, lists],
  );
  // 承認できるか（NGワード・Threadsの上限）。承認のチェックそのものはAPIが行い、ここは表示のため（research.md R3）
  const checks = useMemo(() => {
    const ngWords = data?.ngWords ?? [];
    const map = new Map<string, PublishCheck>();
    for (const d of [...lists.needs_review, ...lists.approved])
      map.set(d.id, checkPublishable(d.body, ngWords));
    return map;
  }, [data, lists]);

  // 類似度（要確認だけ。相手は全状態。FR-026）。計算はブラウザで行う（research.md R8）
  const allDrafts = useMemo(
    () => [...lists.needs_review, ...lists.approved, ...lists.rejected],
    [lists],
  );
  const byId = useMemo(() => new Map(allDrafts.map((d) => [d.id, d])), [allDrafts]);
  const similarities = useSimilarities(lists.needs_review, allDrafts);
  const isSimilar = (d: PostDraft) => (similarities?.get(d.id)?.score ?? 0) >= SIMILARITY_THRESHOLD;

  const items = lists[tab];
  // 一覧から消えた下書き（取り消し・他の端末での削除・状態の変更）は、選択からも外す。
  // 承認の操作ができない人（担当の人。承認はオーナーだけ）は選ばない（まとめての操作は承認・却下のため。specs/008 FR-041）
  const selectable = canReview ? items.filter((d) => d.status !== "publishing") : [];
  const selected = selectable.filter((d) => picked.has(d.id));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(account.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(account.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.autoPost(account.id) });
  };

  const unpick = (ids: string[]) =>
    setPicked((prev) => new Set([...prev].filter((id) => !ids.includes(id))));

  const removeDrafts = (ids: string[]) => {
    unpick(ids);
    remove(ids);
  };

  const runReview = async (
    action: "approve" | "reject" | "reopen" | "requeue",
    targets: PostDraft[],
    options: ReviewOptions = {},
  ) => {
    setBusy(true);
    try {
      const res = await review(action, targets, options);
      // 状態を変えた下書きは選択から外し、飛ばした下書きは選んだまま残す（spec エッジケース）
      if (res) unpick(res.updated.map((d) => d.id));
      return res;
    } finally {
      setBusy(false);
    }
  };

  // 規約に注意の下書き（NGワード・上限で承認できないものは除く）があれば、承認の前に確認する（FR-040）
  const cautionsOf = (d: PostDraft) => {
    const c = checks.get(d.id);
    return c && c.approvable ? c.policyCautions : [];
  };
  const approve = (targets: PostDraft[]) => {
    const cautious = targets.filter((d) => cautionsOf(d).length > 0);
    if (cautious.length > 0) setConfirming({ targets, cautious });
    else void runReview("approve", targets);
  };
  const reopen = (targets: PostDraft[]) => void runReview("reopen", targets);

  // 注意の付いていない下書き：NGワード・Threadsの上限・規約に注意・似ている投稿（80%以上）のどれにも当たらない（FR-004a）
  const isClean = (d: PostDraft) => {
    const c = checks.get(d.id);
    return !!c && c.approvable && c.policyCautions.length === 0 && !isSimilar(d);
  };
  const cleanDrafts = lists.needs_review.filter(isClean);
  const addToSelection = (ds: PostDraft[]) =>
    setPicked((prev) => new Set([...prev, ...ds.map((d) => d.id)]));

  const changeTab = (value: string) => {
    if (!TAB_VALUES.includes(value as StockTab)) return;
    setTab(value as StockTab);
    setPicked(new Set());
  };

  // 似ている相手の下書きへ移る：そのタブに切り替え、下書きまでスクロールして枠を一瞬強調する（FR-028）
  const jumpTo = (target: PostDraft) => {
    changeTab(tabOf(target));
    setTimeout(() => {
      const el = document.getElementById(`draft-${target.id}`);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      el?.classList.add("ring-2", "ring-ring");
      setTimeout(() => el?.classList.remove("ring-2", "ring-ring"), 1500);
    }, 50);
  };

  if (drafts.error)
    return <ApiErrorScreen error={drafts.error} onRetry={() => void drafts.refetch()} />;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = selectable.length > 0 && selected.length === selectable.length;

  const selectionActions =
    tab === "needs_review" ? (
      <>
        <Button
          variant="ghost"
          className="h-10 rounded-full text-destructive md:h-9"
          aria-label="選んだ下書きを削除"
          onClick={() => removeDrafts(selected.map((d) => d.id))}
        >
          削除
        </Button>
        <Button
          variant="outline"
          className="h-10 rounded-full md:h-9"
          disabled={busy}
          onClick={() => setRejecting(selected)}
        >
          まとめて却下
        </Button>
        <Button
          className="h-10 rounded-full md:h-9"
          disabled={busy}
          // まとめて承認は、責任の確認を経てから送る（FR-004b。規約に注意の確認も兼ねる）
          onClick={() => setBulkApproving(selected)}
        >
          まとめて承認
        </Button>
      </>
    ) : tab === "approved" ? (
      <Button className="h-10 rounded-full md:h-9" disabled={busy} onClick={() => reopen(selected)}>
        要確認に戻す
      </Button>
    ) : (
      <>
        <Button
          variant="ghost"
          className="h-10 rounded-full text-destructive md:h-9"
          aria-label="選んだ下書きを削除"
          onClick={() => removeDrafts(selected.map((d) => d.id))}
        >
          削除
        </Button>
        <Button
          className="h-10 rounded-full md:h-9"
          disabled={busy}
          onClick={() => reopen(selected)}
        >
          要確認に戻す
        </Button>
      </>
    );

  const prioritize = async (d: PostDraft) => {
    setBusy(true);
    try {
      await api.prioritizeDraft(account.id, d.id, d.version);
      const list = await drafts.refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.autoPost(account.id) });
      const at = list.data?.schedule[d.id];
      toast.success(
        at ? `次の投稿にしました（${formatRelativeJst(at)}の予定）` : "次の投稿にしました",
      );
      jumpTo(d);
    } catch (error) {
      toast.error(describeError(error));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const renderCard = (d: PostDraft) => {
    const check = checks.get(d.id) ?? checkPublishable(d.body, []);
    // NGワードのラベルは要確認だけ（承認済みには、NGワードの追加で要確認に戻るため残らない。FR-016・FR-016a）
    const showNg = d.status === "needs_review" && check.ngWords.length > 0;
    // 規約に注意は要確認・承認済みに出す（FR-039）
    const showPolicy = d.status !== "rejected" && check.policyCautions.length > 0;
    const marks = highlightsOf(check).filter((m) => (m.kind === "ng" ? showNg : showPolicy));
    return (
      <DraftCard
        key={d.id}
        draft={d}
        canReview={canReview}
        // チームがあるAccountだけ、作った人・直した人を出す（specs/008 FR-053）
        people={access?.hasTeam ? data?.people : undefined}
        selected={picked.has(d.id)}
        check={check}
        busy={busy}
        scheduledAt={data?.schedule[d.id]}
        labels={
          <LabelRow
            labels={[
              showNg && <NgWordLabel key="ng" check={check} />,
              showPolicy && (
                <PolicyCautionLabels
                  key="policy"
                  check={check}
                  onReopen={d.status === "approved" ? () => reopen([d]) : undefined}
                />
              ),
              d.status === "needs_review" && (
                <SimilarityLabel
                  key="similarity"
                  result={similarities ? similarities.get(d.id) : null}
                  find={(id) => byId.get(id)}
                  onJump={jumpTo}
                />
              ),
            ].filter(Boolean)}
          />
        }
        body={marks.length > 0 ? <HighlightedBody body={d.body} marks={marks} /> : undefined}
        actions={{
          onToggle: () => toggle(d.id),
          onApprove: () => approve([d]),
          onReject: () => setRejecting([d]),
          onEdit: () => setEditing(d),
          onDelete: () => removeDrafts([d.id]),
          onReopen: () => reopen([d]),
          onRequeue: () => void runReview("requeue", [d]),
          onPrioritize:
            d.status === "approved" && d.id !== lists.approved[0]?.id
              ? () => void prioritize(d)
              : undefined,
        }}
      />
    );
  };

  return (
    <>
      <PageHeader
        title="投稿ストック"
        actions={
          <Button
            asChild
            className="h-9 rounded-full max-md:size-11 max-md:bg-transparent max-md:p-0 max-md:text-foreground md:pr-4 md:pl-3"
          >
            <Link to={`/accounts/${account.id}/create`} aria-label="投稿をつくる">
              <SquarePenIcon className="size-5 md:size-4" />
              <span className="hidden md:inline">投稿をつくる</span>
            </Link>
          </Button>
        }
      />
      <PageBody className="flex-1 space-y-5">
        <AutoPostNotices accountId={account.id} />
        {access && !canReview && (
          <p className="rounded-xl bg-muted/60 px-4 py-2.5 text-sm text-foreground/80">
            承認と却下は、オーナー（{access.owner.name}）さんが行います。あなたは投稿の案を登録したり、直したりできます。
          </p>
        )}
        <Tabs value={tab} onValueChange={changeTab}>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <StatusTabs counts={counts ?? undefined} />
            {tab !== "published" && selectable.length > 0 && (
              <div className="flex shrink-0 items-center">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm md:min-h-9">
                  <input
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={allSelected}
                    onChange={() =>
                      setPicked(allSelected ? new Set() : new Set(selectable.map((d) => d.id)))
                    }
                  />
                  すべて選択
                </label>
                {tab === "needs_review" && (
                  // 選び方のメニュー（FR-004a）
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground md:size-8"
                        aria-label="選び方"
                      >
                        <ChevronDownIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setPicked(new Set(selectable.map((d) => d.id)))}
                      >
                        すべて選択
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        // 類似度の計算が終わるまでは、似ている投稿を見分けられないので選べない
                        disabled={similarities === null || cleanDrafts.length === 0}
                        onSelect={() => setPicked(new Set(cleanDrafts.map((d) => d.id)))}
                      >
                        {similarities === null
                          ? "承認できるものを選択（類似度を計算中）"
                          : `承認できるものを選択（${cleanDrafts.length}件）`}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPicked(new Set())}>
                        選択を解除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          </div>
          {TAB_VALUES.map((value) => (
            <TabsContent key={value} value={value}>
              {value === "published" ? (
                <PublishedList accountId={account.id} />
              ) : !data ? (
                <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
              ) : (
                <DraftList
                  tab={value}
                  items={lists[value]}
                  limit={data.limits.needsReview}
                  createPath={`/accounts/${account.id}/create`}
                  total={value === "rejected" ? (counts?.rejected ?? 0) : lists[value].length}
                  renderCard={renderCard}
                  failed={value === "approved" ? data.publishFailed : undefined}
                  approvedNotice={
                    data.autoPost?.stoppedReason === "billing_inactive" ? (
                      "このアカウントは今、読むだけのため、自動投稿を止めています"
                    ) : data.autoPost?.stoppedReason === "needs_reconnect" ? (
                      "Threadsとの接続が切れているため、自動投稿を止めています"
                    ) : data.autoPost?.stoppedReason === "rate_limited" ? (
                      "Threadsの投稿数の上限に達したため、今日の投稿を止めました"
                    ) : data.autoPost?.enabled ? (
                      "上から順に、投稿する時刻に1件ずつThreadsへ投稿します"
                    ) : (
                      <>
                        自動投稿はオフです。{" "}
                        <Link
                          className="text-ring underline"
                          to={`/accounts/${account.id}/settings`}
                        >
                          投稿のスケジュールを設定する
                        </Link>
                      </>
                    )
                  }
                  onSelectBatch={addToSelection}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </PageBody>
      {/* 選択のバー。スクロール領域の下端に固定し、767px以下は画面下端の操作バーの領域を避ける */}
      {selected.length > 0 && (
        <div className="sticky bottom-0 z-10 bg-background pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto w-full max-w-3xl px-4 md:px-8">
            <SelectionBar
              selection={{ count: selected.length, onClear: () => setPicked(new Set()), actions: selectionActions }}
            />
          </div>
        </div>
      )}

      {editing && (
        <DraftEditDialog
          accountId={account.id}
          item={editing}
          onSaved={(_d, reopened) => {
            setEditing(null);
            refresh();
            toast.success(reopened ? REOPENED_BY_EDIT : "保存しました");
          }}
          onClose={() => setEditing(null)}
          onDeletedElsewhere={refresh}
          ngWords={data?.ngWords ?? []}
        />
      )}
      {bulkApproving && (
        <BulkApproveDialog
          selected={bulkApproving.length}
          blocked={bulkApproving.filter((d) => !checks.get(d.id)?.approvable).length}
          cautious={bulkApproving.filter((d) => cautionsOf(d).length > 0).length}
          approvedSlots={data ? data.limits.approved - data.counts.approved : 0}
          onConfirm={() => {
            const targets = bulkApproving;
            setBulkApproving(null);
            void runReview("approve", targets, {
              confirmPolicyCaution: targets.some((d) => cautionsOf(d).length > 0),
            });
          }}
          onCancel={() => setBulkApproving(null)}
        />
      )}
      {confirming && (
        <PolicyConfirmDialog
          bulk={confirming.targets.length > 1}
          count={confirming.cautious.length}
          labels={[
            ...new Set(confirming.cautious.flatMap((d) => cautionsOf(d).map((c) => c.label))),
          ]}
          onConfirm={() => {
            const { targets } = confirming;
            setConfirming(null);
            void runReview("approve", targets, { confirmPolicyCaution: true });
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {rejecting && (
        <RejectDialog
          count={rejecting.length}
          // 似た投稿（80%以上）が1件でもあれば「似た投稿がある」を最初から選ぶ（FR-029）
          initialReasons={[
            ...(rejecting.some(isSimilar) ? (["similar"] as const) : []),
            ...(rejecting.some((d) => cautionsOf(d).length > 0) ? (["policy"] as const) : []),
          ]}
          submitting={busy}
          onSubmit={(reject) => {
            const targets = rejecting;
            setRejecting(null);
            void runReview("reject", targets, { reject });
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  );
}

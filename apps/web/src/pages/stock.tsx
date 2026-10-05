// 投稿ストックの画面（specs/003 US1〜US3・specs/004 US1〜US5、contracts/ui-routes.md「投稿ストックの画面」、docs/ui-design.md 型C）。
// 上から：プロンプトのカード → 状態のタブ（要確認／承認済み／却下）と下書きの一覧 → 画面下部に固定の貼り付け欄（選択中は選択のバー）。
// 下書きの削除は確認を求めず、トーストの「元に戻す」で取り消せる（003 Clarifications 2026-10-04）。
// 承認・却下・要確認に戻すも、トーストの「元に戻す」で取り消せる（004 FR-008）。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SIMILARITY_THRESHOLD,
  checkPublishable,
  type PostDraft,
  type PostDraftStatus,
  type PublishCheck,
} from "@threads-grower/shared";
import { useMemo, useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
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
import { PasteComposer } from "@/components/stock/PasteComposer";
import { PromptCard } from "@/components/stock/PromptCard";
import { RejectDialog } from "@/components/stock/RejectDialog";
import { REOPENED_BY_EDIT } from "@/components/stock/messages";
import { PolicyConfirmDialog } from "@/components/stock/PolicyConfirmDialog";
import { BulkApproveDialog } from "@/components/stock/BulkApproveDialog";
import { StatusTabs, useStatusTab } from "@/components/stock/StatusTabs";
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
import { ChevronDownIcon } from "lucide-react";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useCurrentAccount } from "@/pages/account-layout";

const TAB_VALUES: PostDraftStatus[] = ["needs_review", "approved", "rejected"];

/**
 * 投稿ストックの画面。プロンプトのコピー、貼り付けによる一括登録、下書きの確認・修正・削除・承認・却下。
 * @returns 投稿ストックの画面
 */
export function StockPage() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const drafts = useQuery({
    queryKey: queryKeys.postDrafts(account.id),
    queryFn: () => api.listPostDrafts(account.id),
  });
  const { tab, setTab } = useStatusTab();
  const location = useLocation();
  // サイドバーの「投稿をつくる」から来たか。押すたびに location.key が変わるので、それをキーにする
  const startKey = (location.state as { startCreate?: boolean } | null)?.startCreate
    ? location.key
    : undefined;
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
  const { hidden, remove, flush } = useDeferredDelete(account.id);
  const { review } = useReview(account.id);
  const data = drafts.data;

  // 削除して確定を待っている下書きは、一覧から隠す
  const lists = useMemo<Record<PostDraftStatus, PostDraft[]>>(
    () => ({
      needs_review: (data?.needsReview ?? []).filter((d) => !hidden.has(d.id)),
      approved: data?.approved ?? [],
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
  // 一覧から消えた下書き（取り消し・他の端末での削除・状態の変更）は、選択からも外す
  const selected = useMemo(() => items.filter((d) => picked.has(d.id)), [items, picked]);
  const atLimit = data ? lists.needs_review.length >= data.limits.needsReview : false;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(account.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(account.id) });
  };

  const unpick = (ids: string[]) =>
    setPicked((prev) => new Set([...prev].filter((id) => !ids.includes(id))));

  const removeDrafts = (ids: string[]) => {
    unpick(ids);
    remove(ids);
  };

  const runReview = async (
    action: "approve" | "reject" | "reopen",
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
    if (!TAB_VALUES.includes(value as PostDraftStatus)) return;
    setTab(value as PostDraftStatus);
    setPicked(new Set());
  };

  // 似ている相手の下書きへ移る：そのタブに切り替え、下書きまでスクロールして枠を一瞬強調する（FR-028）
  const jumpTo = (target: PostDraft) => {
    changeTab(target.status);
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
  const allSelected = items.length > 0 && selected.length === items.length;

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
        selected={picked.has(d.id)}
        check={check}
        busy={busy}
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
        }}
      />
    );
  };

  return (
    <>
      <PageHeader title="投稿ストック" />
      <PageBody className="flex-1 space-y-5">
        {data ? (
          <PromptCard
            accountId={account.id}
            canGeneratePrompt={data.canGeneratePrompt}
            promptPostCount={data.promptPostCount}
            startKey={startKey}
          />
        ) : (
          <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        )}
        <Tabs value={tab} onValueChange={changeTab}>
          <div className="flex items-center justify-between gap-3">
            <StatusTabs counts={counts ?? undefined} />
            {items.length > 0 && (
              <div className="flex shrink-0 items-center">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm md:min-h-9">
                  <input
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={allSelected}
                    onChange={() =>
                      setPicked(allSelected ? new Set() : new Set(items.map((d) => d.id)))
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
                      <DropdownMenuItem onSelect={() => setPicked(new Set(items.map((d) => d.id)))}>
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
              {!data ? (
                <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
              ) : (
                <DraftList
                  tab={value}
                  items={lists[value]}
                  limit={data.limits.needsReview}
                  canGeneratePrompt={data.canGeneratePrompt}
                  total={value === "rejected" ? (counts?.rejected ?? 0) : lists[value].length}
                  renderCard={renderCard}
                  onSelectBatch={addToSelection}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </PageBody>
      {/* 貼り付け欄。スクロール領域の下端に固定し、767px以下は画面下端の操作バーの領域を避ける */}
      <div className="sticky bottom-0 z-10 bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 md:px-8">
          <PasteComposer
            accountId={account.id}
            atLimit={atLimit}
            // 削除して確定を待っている下書きは、まだサーバーで数えられているので、登録の前に確定する
            beforeSubmit={flush}
            // プロンプトを作れないとき（プラン1）は、「投稿をつくる」で貼り付け欄から始める
            focusKey={data && !data.canGeneratePrompt ? startKey : undefined}
            selection={{
              count: selected.length,
              onClear: () => setPicked(new Set()),
              actions: selectionActions,
            }}
          />
        </div>
      </div>

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

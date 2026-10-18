// リサーチの画面（specs/002 US3、contracts/ui-routes.md「リサーチの画面」、docs/ui-design.md 型B）。
// 上部のタブで「参考投稿」と「キーワード」を切り替える（選択中のタブはクエリ ?tab= に持つ）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReferencePost, ResearchKeyword } from "@threads-grower/shared";
import { EllipsisIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { BillingRequiredDialog } from "@/components/billing/BillingRequiredDialog";
import { ConfirmDeleteDialog } from "@/components/items/ConfirmDeleteDialog";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { KeywordFormDialog } from "@/components/research/KeywordFormDialog";
import { ResearchGuide } from "@/components/guides/ResearchGuide";
import { ExplainBatchPanel } from "@/components/research/ExplainBatchPanel";
import { KeywordIdeasPanel } from "@/components/research/KeywordIdeasPanel";
import { ExplainOne } from "@/components/research/ExplainOne";
import { ReferenceBadges } from "@/components/research/ReferenceBadges";
import { ReferencePostAddDialog } from "@/components/research/ReferencePostAddDialog";
import { ReferencePostFormDialog } from "@/components/research/ReferencePostFormDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { billingReasonOf, isBillingRequired, saveErrorMessage } from "@/lib/save-error";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/pages/account-layout";

type Tab = "posts" | "keywords";
type Dialog =
  { kind: "post"; item?: ReferencePost } | { kind: "keyword"; item?: ResearchKeyword } | null;
type ToDelete =
  { kind: "post"; item: ReferencePost } | { kind: "keyword"; item: ResearchKeyword } | null;

/**
 * リサーチの画面。参考投稿とキーワードの一覧・追加・編集・削除。
 * @returns リサーチの画面
 */
export function ResearchPage() {
  const account = useCurrentAccount();
  // アカウントを切り替えたら作り直す（追加の欄・ためた投稿をほかのアカウントへ持ち越さない。PR #17 のCodexレビュー）
  return <ResearchPageContent key={account.id} />;
}

/**
 * リサーチの画面の中身（1つのAccount分）。
 * @returns リサーチの画面
 */
function ResearchPageContent() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "keywords" ? "keywords" : "posts";
  const posts = useQuery({
    queryKey: queryKeys.referencePosts(account.id),
    queryFn: () => api.listReferencePosts(account.id),
  });
  const keywords = useQuery({
    queryKey: queryKeys.researchKeywords(account.id),
    queryFn: () => api.listResearchKeywords(account.id),
  });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toDelete, setToDelete] = useState<ToDelete>(null);
  const [readOnlyLost, setReadOnlyLost] = useState(false);
  const [billingReason, setBillingReason] = useState<string | null>(null);

  // 「投稿をつくる」の「解説がまだ」から来たら、まとめての解説へ移る（specs/014 FR-122）
  const { hash } = useLocation();
  const postsLoaded = posts.isSuccess;
  useEffect(() => {
    if (postsLoaded && hash === "#explain")
      document.getElementById("explain")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [postsLoaded, hash]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.referencePosts(account.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.researchKeywords(account.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.profileStatus(account.id) });
  };

  const remove = useMutation({
    mutationFn: (target: NonNullable<ToDelete>) =>
      target.kind === "post"
        ? api.deleteReferencePost(account.id, target.item.id)
        : api.deleteResearchKeyword(account.id, target.item.id),
    onSuccess: () => {
      setToDelete(null);
      refresh();
      toast.success("削除しました");
    },
    onError: (err) => {
      setToDelete(null);
      if (isBillingRequired(err)) setBillingReason(billingReasonOf(err) ?? "");
      else toast.error(saveErrorMessage(err));
    },
  });

  const failed = posts.error ?? keywords.error;
  if (failed) {
    return (
      <ApiErrorScreen
        error={failed}
        onRetry={() => {
          void posts.refetch();
          void keywords.refetch();
        }}
      />
    );
  }

  const canEdit = (posts.data?.canEdit ?? false) && !readOnlyLost;
  // 画面を開いたときに直せた人には、読むだけになった後もAIの欄を残す（貼り付けた内容を失わないように。PR #17 のCodexレビュー）。
  // 初めから読むだけ・見せてもらっている人には出さない（FR-008、SC-008）
  const keepAiPanels = posts.data?.canEdit ?? false;
  const current = tab === "posts" ? posts.data : keywords.data;
  const atLimit = current ? current.items.length >= current.limit : false;
  const addLabel = tab === "posts" ? "参考投稿を追加" : "キーワードを追加";

  const addButton = canEdit ? (
    <Button
      className="h-9 rounded-full max-md:size-11 max-md:bg-transparent max-md:p-0 max-md:text-foreground md:pr-4 md:pl-3"
      disabled={atLimit || !current}
      aria-label={addLabel}
      onClick={() => setDialog(tab === "posts" ? { kind: "post" } : { kind: "keyword" })}
    >
      <PlusIcon className="size-5 md:size-4" />
      <span className="hidden md:inline">{addLabel}</span>
    </Button>
  ) : null;

  const menu = (label: string, onEdit: () => void, onDelete: () => void): ReactNode =>
    canEdit ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="-my-2 -mr-2 size-11 shrink-0 text-muted-foreground md:size-8"
            aria-label={`${label}の操作`}
          >
            <EllipsisIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>編集</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
            削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const limitNotice = canEdit && atLimit && current && (
    <p
      role="status"
      className="mb-3 rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm"
    >
      登録できる上限（{current.limit}件）に達しています。不要なものを削除してから追加してください。
    </p>
  );

  const onSaved = () => {
    setDialog(null);
    refresh();
    toast.success("保存しました");
  };
  const dialogCallbacks = {
    onSaved,
    onClose: () => setDialog(null),
    // ダイアログは閉じずに、入力内容を読むだけで残す（閉じるのはユーザーの操作で）
    onReadOnly: () => setReadOnlyLost(true),
    onDeletedElsewhere: refresh,
    onLimitReached: refresh,
  };

  return (
    <>
      <PageHeader title="リサーチ" actions={addButton} />
      <PageBody className="space-y-5 pb-16">
        <p className="text-[15px] text-muted-foreground">
          Threadsで検索して、反応の良い投稿を見つけたら保存しましょう。「なぜ良いか」を書いておくと、投稿の材料になります。
        </p>
        <Tabs
          value={tab}
          onValueChange={(v) =>
            setParams(v === "keywords" ? { tab: "keywords" } : {}, { replace: true })
          }
        >
          <TabsList>
            <TabsTrigger value="posts">参考投稿</TabsTrigger>
            <TabsTrigger value="keywords">キーワード</TabsTrigger>
          </TabsList>
          {/* リサーチのやり方（初めは閉じる。specs/014 FR-060） */}
          <div className="mt-3 mb-3">
            <ResearchGuide />
          </div>
          <TabsContent value="posts">
            {limitNotice}
            {keepAiPanels && posts.data && (
              <div className="mb-3">
                <ExplainBatchPanel
                  readOnly={!canEdit}
                  accountId={account.id}
                  posts={posts.data.items}
                  onSaved={refresh}
                  onBillingRequired={(reason) => setBillingReason(reason)}
                />
              </div>
            )}
            {!posts.data ? (
              <Skeleton />
            ) : posts.data.items.length === 0 ? (
              <Empty>
                まだ参考投稿がありません。Threadsで見つけた反応の良い投稿を保存しましょう。
              </Empty>
            ) : (
              <div className="space-y-2.5">
                {posts.data.items.map((p) => (
                  <ReferencePostCard
                    key={p.id}
                    item={p}
                    canEdit={canEdit}
                    onEdit={() => setDialog({ kind: "post", item: p })}
                    menu={menu(
                      "参考投稿",
                      () => setDialog({ kind: "post", item: p }),
                      () => setToDelete({ kind: "post", item: p }),
                    )}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="keywords">
            {limitNotice}
            {keepAiPanels && keywords.data && (
              <KeywordIdeasPanel
                readOnly={!canEdit}
                accountId={account.id}
                registered={keywords.data.items.map((k) => k.keyword)}
                remaining={Math.max(0, keywords.data.limit - keywords.data.items.length)}
                onSaved={refresh}
                onBillingRequired={(reason) => setBillingReason(reason)}
              />
            )}
            {!keywords.data ? (
              <Skeleton />
            ) : keywords.data.items.length === 0 ? (
              <Empty>
                まだキーワードがありません。リサーチで検索する言葉を登録しておきましょう。
              </Empty>
            ) : (
              <ul className="divide-y rounded-2xl border">
                {keywords.data.items.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex min-w-0 flex-1 flex-col gap-x-3 md:flex-row md:items-baseline">
                      <span className="font-medium break-words">{k.keyword}</span>
                      {k.purpose && (
                        <span className="text-[13px] text-muted-foreground">{k.purpose}</span>
                      )}
                    </span>
                    {/* だれでも使える（見せてもらっている人・読むだけの人も。specs/014 FR-093） */}
                    <a
                      href={`https://www.threads.com/search?q=${encodeURIComponent(k.keyword)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`「${k.keyword}」をThreadsで検索`}
                      className="flex shrink-0 items-center gap-1 text-[13px] text-ring underline"
                    >
                      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                      <span className="hidden md:inline">Threadsで検索</span>
                    </a>
                    {menu(
                      k.keyword,
                      () => setDialog({ kind: "keyword", item: k }),
                      () => setToDelete({ kind: "keyword", item: k }),
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>

      {dialog?.kind === "post" && !dialog.item && posts.data && (
        <ReferencePostAddDialog
          accountId={account.id}
          remaining={Math.max(0, posts.data.limit - posts.data.items.length)}
          onSaved={() => {
            setDialog(null);
            refresh();
          }}
          onClose={() => setDialog(null)}
          onReadOnly={() => setReadOnlyLost(true)}
          onLimitReached={refresh}
        />
      )}
      {dialog?.kind === "post" && dialog.item && (
        <ReferencePostFormDialog
          accountId={account.id}
          item={dialog.item}
          {...dialogCallbacks}
          whyGoodExtra={(setWhyGood, onDirtyChange) => (
            <ExplainOne
              accountId={account.id}
              postId={dialog.item!.id}
              onUse={setWhyGood}
              onDirtyChange={onDirtyChange}
            />
          )}
        />
      )}
      {dialog?.kind === "keyword" && (
        <KeywordFormDialog
          accountId={account.id}
          item={dialog.item}
          existing={keywords.data?.items ?? []}
          {...dialogCallbacks}
        />
      )}
      <ConfirmDeleteDialog
        name={
          toDelete
            ? toDelete.kind === "post"
              ? "この参考投稿"
              : `「${toDelete.item.keyword}」`
            : null
        }
        deleting={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
      <BillingRequiredDialog
        reason={billingReason}
        onClose={() => {
          setBillingReason(null);
          setReadOnlyLost(true);
        }}
      />
    </>
  );
}

function Skeleton() {
  return <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-[15px] text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * 参考投稿の分かっている閲覧数といいねの1行（specs/014 US7-8）。
 * @param item - 参考投稿
 * @returns 「閲覧 32,000 ・ いいね 820」、どちらもなければ ""
 */
function metricsLine(item: ReferencePost): string {
  const parts: string[] = [];
  if (item.metrics.views !== null) parts.push(`閲覧 ${item.metrics.views.toLocaleString("ja-JP")}`);
  if (item.metrics.likes !== null)
    parts.push(`いいね ${item.metrics.likes.toLocaleString("ja-JP")}`);
  return parts.join(" ・ ");
}

function ReferencePostCard({
  item,
  canEdit,
  onEdit,
  menu,
}: {
  item: ReferencePost;
  canEdit: boolean;
  onEdit: () => void;
  menu: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = item.body.split("\n").length > 6 || item.body.length > 240;
  return (
    <article className="space-y-2 rounded-2xl border bg-card px-4 py-3.5">
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "flex-1 text-[15px] whitespace-pre-wrap break-words",
            !expanded && "line-clamp-6",
          )}
        >
          {item.body}
        </p>
        {menu}
      </div>
      {long && (
        <button
          type="button"
          className="text-[13px] underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "閉じる" : "もっと見る"}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <ReferenceBadges
          platform={item.platform}
          freshness={item.freshness}
          explained={item.whyGood.trim() !== ""}
        />
        {item.keyword && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-foreground">
            {item.keyword}
          </span>
        )}
        {metricsLine(item) && <span>{metricsLine(item)}</span>}
        <span>{formatDateTime(item.createdAt)}</span>
        {item.postUrl && (
          <a
            href={item.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-ring underline"
          >
            <span className="truncate">投稿を開く</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
        )}
      </div>
      {item.whyGood ? (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap">
          <span className="font-medium">なぜ良いか：</span>
          {item.whyGood}
        </p>
      ) : canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="text-left text-sm text-muted-foreground underline"
        >
          なぜ良いか：未入力
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">なぜ良いか：未入力</p>
      )}
    </article>
  );
}

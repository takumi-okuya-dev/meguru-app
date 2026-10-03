// リサーチの画面（specs/002 US3、contracts/ui-routes.md「リサーチの画面」、docs/ui-design.md 型B）。
// 上部のタブで「参考投稿」と「キーワード」を切り替える（選択中のタブはクエリ ?tab= に持つ）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReferencePost, ResearchKeyword } from "@threads-grower/shared";
import { EllipsisIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { GrowerRequiredBanner, GrowerRequiredDialog } from "@/components/GrowerRequiredNotice";
import { ConfirmDeleteDialog } from "@/components/items/ConfirmDeleteDialog";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { KeywordFormDialog } from "@/components/research/KeywordFormDialog";
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
import { isGrowerRequired, saveErrorMessage } from "@/lib/save-error";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/pages/account-layout";

type Tab = "posts" | "keywords";
type Dialog =
  | { kind: "post"; item?: ReferencePost }
  | { kind: "keyword"; item?: ResearchKeyword }
  | null;
type ToDelete = { kind: "post"; item: ReferencePost } | { kind: "keyword"; item: ResearchKeyword } | null;

/**
 * リサーチの画面。参考投稿とキーワードの一覧・追加・編集・削除。
 * @returns リサーチの画面
 */
export function ResearchPage() {
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
  const [growerLost, setGrowerLost] = useState(false);
  const [growerDialog, setGrowerDialog] = useState(false);

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
      if (isGrowerRequired(err)) setGrowerDialog(true);
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

  const canEdit = (posts.data?.canEdit ?? false) && !growerLost;
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
          <Button variant="ghost" size="icon" className="-my-2 -mr-2 size-11 shrink-0 text-muted-foreground md:size-8" aria-label={`${label}の操作`}>
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
    <p role="status" className="mb-3 rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
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
    onGrowerLost: () => setGrowerLost(true),
    onDeletedElsewhere: refresh,
    onLimitReached: refresh,
  };

  return (
    <>
      <PageHeader title="リサーチ" actions={addButton} />
      <PageBody className="space-y-5 pb-16">
        {!canEdit && posts.data && <GrowerRequiredBanner />}
        <div className="space-y-2">
          <p className="text-[15px] text-muted-foreground">
            Threadsで検索して、反応の良い投稿を見つけたら保存しましょう。「なぜ良いか」を書いておくと、投稿の材料になります。
          </p>
          <details className="rounded-xl border px-4 py-2.5 text-sm">
            <summary className="cursor-pointer py-1 font-medium">リサーチの手順</summary>
            <ol className="list-decimal space-y-1 py-2 pl-5 text-muted-foreground">
              <li>キーワードでThreadsを検索する</li>
              <li>反応の良い投稿の本文をコピーして保存する</li>
              <li>なぜ良いかを書き残す（ChatGPTやClaudeに分析してもらった結果を貼り付けてもよい）</li>
            </ol>
          </details>
        </div>
        <Tabs value={tab} onValueChange={(v) => setParams(v === "keywords" ? { tab: "keywords" } : {}, { replace: true })}>
          <TabsList>
            <TabsTrigger value="posts">参考投稿</TabsTrigger>
            <TabsTrigger value="keywords">キーワード</TabsTrigger>
          </TabsList>
          <TabsContent value="posts">
            {limitNotice}
            {!posts.data ? (
              <Skeleton />
            ) : posts.data.items.length === 0 ? (
              <Empty>まだ参考投稿がありません。Threadsで見つけた反応の良い投稿を保存しましょう。</Empty>
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
            {!keywords.data ? (
              <Skeleton />
            ) : keywords.data.items.length === 0 ? (
              <Empty>まだキーワードがありません。リサーチで検索する言葉を登録しておきましょう。</Empty>
            ) : (
              <ul className="divide-y rounded-2xl border">
                {keywords.data.items.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex min-w-0 flex-1 flex-col gap-x-3 md:flex-row md:items-baseline">
                      <span className="font-medium break-words">{k.keyword}</span>
                      {k.purpose && <span className="text-[13px] text-muted-foreground">{k.purpose}</span>}
                    </span>
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

      {dialog?.kind === "post" && <ReferencePostFormDialog accountId={account.id} item={dialog.item} {...dialogCallbacks} />}
      {dialog?.kind === "keyword" && (
        <KeywordFormDialog
          accountId={account.id}
          item={dialog.item}
          existing={keywords.data?.items ?? []}
          {...dialogCallbacks}
        />
      )}
      <ConfirmDeleteDialog
        name={toDelete ? (toDelete.kind === "post" ? "この参考投稿" : `「${toDelete.item.keyword}」`) : null}
        deleting={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
      <GrowerRequiredDialog
        open={growerDialog}
        onClose={() => {
          setGrowerDialog(false);
          setGrowerLost(true);
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
    <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-[15px] text-muted-foreground">{children}</div>
  );
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
        <p className={cn("flex-1 text-[15px] whitespace-pre-wrap break-words", !expanded && "line-clamp-6")}>{item.body}</p>
        {menu}
      </div>
      {long && (
        <button type="button" className="text-[13px] underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "閉じる" : "もっと見る"}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {item.keyword && <span className="rounded-full bg-muted px-2.5 py-0.5 text-foreground">{item.keyword}</span>}
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
        <button type="button" onClick={onEdit} className="text-left text-sm text-muted-foreground underline">
          なぜ良いか：未入力
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">なぜ良いか：未入力</p>
      )}
    </article>
  );
}

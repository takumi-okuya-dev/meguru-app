// 投稿ストックの画面（specs/003 US1〜US3、contracts/ui-routes.md「投稿ストックの画面」、docs/ui-design.md 型C）。
// 上から：プロンプトのカード → 状態のタブと下書きの一覧 → 画面下部に固定の貼り付け欄（選択中は選択のバー）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostDraft } from "@threads-grower/shared";
import { EllipsisIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConfirmDeleteDialog } from "@/components/items/ConfirmDeleteDialog";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { DraftEditDialog } from "@/components/stock/DraftEditDialog";
import { DraftList } from "@/components/stock/DraftList";
import { PasteComposer } from "@/components/stock/PasteComposer";
import { PromptCard } from "@/components/stock/PromptCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { saveErrorMessage } from "@/lib/save-error";
import { useCurrentAccount } from "@/pages/account-layout";

type ToDelete = { ids: string[]; name: string } | null;

const excerpt = (body: string) => {
  const line = body.split("\n")[0] ?? "";
  return line.length > 20 ? `${line.slice(0, 20)}…` : line;
};

/**
 * 投稿ストックの画面。プロンプトのコピー、貼り付けによる一括登録、要確認の下書きの確認・修正・削除。
 * @returns 投稿ストックの画面
 */
export function StockPage() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const drafts = useQuery({
    queryKey: queryKeys.postDrafts(account.id),
    queryFn: () => api.listPostDrafts(account.id),
  });
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<PostDraft | null>(null);
  const [toDelete, setToDelete] = useState<ToDelete>(null);

  const items = useMemo(() => drafts.data?.items ?? [], [drafts.data]);
  // 一覧から消えた下書き（取り消し・他の端末での削除）は、選択からも外す
  const selected = useMemo(() => new Set(items.filter((d) => picked.has(d.id)).map((d) => d.id)), [items, picked]);
  const atLimit = drafts.data ? items.length >= drafts.data.limit : false;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(account.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(account.id) });
  };

  const remove = useMutation({
    mutationFn: (ids: string[]) => api.deletePostDrafts(account.id, ids),
    onSuccess: (_, ids) => {
      setToDelete(null);
      setPicked((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      refresh();
      toast.success("削除しました");
    },
    onError: (err) => {
      setToDelete(null);
      toast.error(saveErrorMessage(err));
    },
  });

  if (drafts.error) return <ApiErrorScreen error={drafts.error} onRetry={() => void drafts.refetch()} />;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <>
      <PageHeader title="投稿ストック" />
      <PageBody className="flex-1 space-y-5">
        {drafts.data ? (
          <PromptCard
            accountId={account.id}
            canGeneratePrompt={drafts.data.canGeneratePrompt}
            promptPostCount={drafts.data.promptPostCount}
          />
        ) : (
          <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        )}
        <Tabs value="needs_review">
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="needs_review">要確認 {drafts.data ? items.length : ""}</TabsTrigger>
            </TabsList>
            {items.length > 0 && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm md:min-h-9">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={allSelected}
                  onChange={() => setPicked(allSelected ? new Set() : new Set(items.map((d) => d.id)))}
                />
                すべて選択
              </label>
            )}
          </div>
          <TabsContent value="needs_review">
            {!drafts.data ? (
              <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
            ) : (
              <DraftList
                items={items}
                limit={drafts.data.limit}
                canGeneratePrompt={drafts.data.canGeneratePrompt}
                renderControls={(d) => ({
                  leading: (
                    // タッチ操作でも押しやすいよう、押せる範囲を44px角にする
                    <label className="-my-1.5 -ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center md:size-9">
                      <input
                        type="checkbox"
                        className="size-4 accent-foreground"
                        aria-label={`「${excerpt(d.body)}」を選択`}
                        checked={selected.has(d.id)}
                        onChange={() => toggle(d.id)}
                      />
                    </label>
                  ),
                  trailing: (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="-my-1.5 -mr-1.5 size-11 shrink-0 text-muted-foreground md:size-8"
                          aria-label={`「${excerpt(d.body)}」の操作`}
                        >
                          <EllipsisIcon className="size-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(d)}>編集</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => setToDelete({ ids: [d.id], name: "この下書き" })}
                        >
                          削除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ),
                })}
              />
            )}
          </TabsContent>
        </Tabs>
      </PageBody>
      {/* 貼り付け欄。スクロール領域の下端に固定し、767px以下は画面下端の操作バーの領域を避ける */}
      <div className="sticky bottom-0 z-10 bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 md:px-8">
          <PasteComposer
            accountId={account.id}
            atLimit={atLimit}
            selection={{
              count: selected.size,
              onClear: () => setPicked(new Set()),
              onDelete: () => setToDelete({ ids: [...selected], name: `${selected.size}件の下書き` }),
            }}
          />
        </div>
      </div>

      {editing && (
        <DraftEditDialog
          accountId={account.id}
          item={editing}
          onSaved={() => {
            setEditing(null);
            refresh();
            toast.success("保存しました");
          }}
          onClose={() => setEditing(null)}
          onDeletedElsewhere={refresh}
        />
      )}
      <ConfirmDeleteDialog
        name={toDelete?.name ?? null}
        deleting={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.ids)}
      />
    </>
  );
}

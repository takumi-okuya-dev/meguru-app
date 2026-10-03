// 投稿ストックの画面（specs/003 US1〜US3、contracts/ui-routes.md「投稿ストックの画面」、docs/ui-design.md 型C）。
// 上から：プロンプトのカード → 状態のタブと下書きの一覧 → 画面下部に固定の貼り付け欄。
import { useQuery } from "@tanstack/react-query";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useCurrentAccount } from "@/pages/account-layout";

/**
 * 投稿ストックの画面。プロンプトのコピー、貼り付けによる一括登録、要確認の下書きの確認・修正・削除。
 * @returns 投稿ストックの画面
 */
export function StockPage() {
  const account = useCurrentAccount();
  const drafts = useQuery({
    queryKey: queryKeys.postDrafts(account.id),
    queryFn: () => api.listPostDrafts(account.id),
  });

  if (drafts.error) return <ApiErrorScreen error={drafts.error} onRetry={() => void drafts.refetch()} />;

  return (
    <>
      <PageHeader title="投稿ストック" />
      <PageBody className="flex-1 space-y-5">
        <section aria-label="プロンプト" data-slot="prompt-card" />
        <Tabs value="needs_review">
          <TabsList>
            <TabsTrigger value="needs_review">要確認 {drafts.data?.items.length ?? ""}</TabsTrigger>
          </TabsList>
          <TabsContent value="needs_review">
            {!drafts.data ? (
              <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
            ) : (
              <div data-slot="draft-list" />
            )}
          </TabsContent>
        </Tabs>
      </PageBody>
      {/* 貼り付け欄。スクロール領域の下端に固定し、767px以下は画面下端の操作バーの領域を避ける */}
      <div className="sticky bottom-0 z-10 bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 md:px-8" data-slot="composer" />
      </div>
    </>
  );
}

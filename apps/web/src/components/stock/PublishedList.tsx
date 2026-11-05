import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { Button } from "@/components/ui/button";
import type { MentionSettings, NgWordForMatch } from "@threads-grower/shared";
import { MentionPanel } from "./MentionPanel";
import { PublishedCard } from "./PublishedCard";
import { usePublished } from "./use-published";

/**
 * 投稿済みのタブ。開いている間だけページを読み、失敗時には再読み込みできる。
 * @param props - accountId：AccountのID、mention：時間差のメンションの設定・NGワード・付けられるか（specs/023）
 * @returns 投稿済みの一覧
 */
export function PublishedList({
  accountId,
  mention,
}: {
  accountId: string;
  mention?: { settings: MentionSettings | undefined; ngWords: readonly NgWordForMatch[]; canReview: boolean };
}) {
  const query = usePublished(accountId);
  if (query.isError)
    return <ApiErrorScreen error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data)
    return <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />;
  const posts = query.data.pages.flatMap((p) => p.items);
  if (!posts.length)
    return (
      <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        まだ投稿はありません。承認した下書きは、投稿のスケジュールに沿って投稿されます
      </p>
    );
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {posts.map((post) => (
          <PublishedCard
            key={post.id}
            post={post}
            mention={
              mention && (
                <MentionPanel
                  accountId={accountId}
                  target={{ id: post.id, version: post.version, kind: "published", mention: post.mention, publishedAt: post.publishedAt, threadsMediaId: post.threadsMediaId }}
                  settings={mention.settings}
                  ngWords={mention.ngWords}
                  canReview={mention.canReview}
                />
              )
            }
          />
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "読み込み中…" : "もっと見る"}
        </Button>
      )}
    </div>
  );
}

import type { PublishedPost } from "@threads-grower/shared";
import type { ReactNode } from "react";
import { formatRelativeJst } from "@/lib/format";

/**
 * 編集できない投稿済みのカード。ThreadsのURLが未取得ならその状態を伝える。
 * @param props - post：投稿済みの本文と公開の記録、mention：時間差のメンションの枠（specs/023）
 * @returns 投稿済みのカード
 */
export function PublishedCard({ post, mention }: { post: PublishedPost; mention?: ReactNode }) {
  return (
    <li className="space-y-2 rounded-2xl border bg-card px-4 py-3">
      <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{post.body}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <span>{formatRelativeJst(post.publishedAt)}に投稿</span>
        {post.threadsPermalink ? (
          <a
            className="text-ring underline"
            href={post.threadsPermalink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Threadsで開く
          </a>
        ) : (
          <span>URLを取得中</span>
        )}
      </div>
      {mention}
    </li>
  );
}

// 手伝っているアカウント（specs/008-team-operations contracts/ui-routes.md「手伝っているアカウント」、US5・FR-061）。
// PCは表、767px以下は1件1枚のカード。行（カード）全体がそのAccountのホームへのリンク。
import { useQuery } from "@tanstack/react-query";
import type { PartnerSummary } from "@threads-grower/shared";
import { TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router";
import { AccountAvatar } from "@/components/AccountAvatar";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { JudgmentDot } from "@/components/performance/JudgmentBadge";
import { api } from "@/lib/api-client";
import { formatRelativeJst } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { MD_QUERY, useMediaQuery } from "@/lib/use-media-query";

type Item = PartnerSummary["items"][number];

/**
 * 承認済みの件数と残りの日数。
 * @param props - item：行
 * @returns 表示
 */
function Approved({ item }: { item: Item }) {
  return (
    <span className="flex flex-col leading-tight">
      <span>{item.approved.count}件</span>
      {item.nextPost.state === "paused" ? (
        <span className="text-xs text-warning">投稿を止めています</span>
      ) : (
        item.approved.days !== null && <span className="text-xs text-muted-foreground">あと{item.approved.days}日分</span>
      )}
    </span>
  );
}

/**
 * 次の投稿の予定（要再接続なら「オーナーの再接続待ち」。FR-044）。
 * @param props - item：行
 * @returns 表示
 */
function NextPost({ item }: { item: Item }) {
  if (item.account.connectionStatus === "needs_reconnect") {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-warning">
        <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
        オーナーの再接続待ち
      </span>
    );
  }
  if (item.nextPost.state === "off") return <span className="text-muted-foreground">自動投稿オフ</span>;
  if (item.nextPost.state === "paused") return <span className="text-muted-foreground">停止中</span>;
  if (!item.nextPost.at || item.nextPost.state === "none") return <span className="text-muted-foreground">承認済みなし</span>;
  return <span>{formatRelativeJst(item.nextPost.at)}</span>;
}

/**
 * 直近7日の判定（006のアイコンと件数。読み上げは文字で）。
 * @param props - item：行
 * @returns 表示
 */
function Judgments({ item }: { item: Item }) {
  const j = item.judgments7d;
  return (
    <span className="flex gap-2 text-[13px]">
      {(
        [
          ["good", "伸びた", j.good],
          ["normal", "いつも通り", j.normal],
          ["poor", "伸びなかった", j.poor],
        ] as const
      ).map(([kind, label, n]) => (
        <span key={kind} className="inline-flex items-center gap-1" aria-label={`${label} ${n}件`}>
          <JudgmentDot kind={kind} className="size-5" />
          <span aria-hidden="true">{n}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * 任された範囲のチップ。
 * @param props - item：行
 * @returns 表示
 */
function Delegation({ item }: { item: Item }) {
  const chips = [item.delegation.review && "承認", item.delegation.settings && "設定"].filter(Boolean) as string[];
  if (chips.length === 0) return <span className="text-[13px] text-muted-foreground">なし</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {c}
        </span>
      ))}
    </span>
  );
}

/**
 * アカウントの名前の欄。
 * @param props - item：行
 * @returns 表示
 */
function AccountCell({ item }: { item: Item }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <AccountAvatar account={item.account} className="size-9" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-semibold">{item.account.displayName ?? item.account.username}</span>
        <span className="truncate text-xs text-muted-foreground">オーナー {item.ownerName}</span>
      </span>
    </span>
  );
}

const editorNames = (item: Item) => item.editors.map((e) => e.name.split(/\s/)[0]).join("・") || "なし";

/**
 * 手伝っているアカウントのまとめの画面。
 * @returns 画面
 */
export function PartnerAccountsPage() {
  const isWide = useMediaQuery(MD_QUERY);
  const summary = useQuery({ queryKey: queryKeys.teamAccounts, queryFn: api.getTeamAccounts });
  if (summary.isPending) return <div className="m-6 h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" />;
  if (summary.isError) return <ApiErrorScreen error={summary.error} onRetry={() => void summary.refetch()} />;
  const items = summary.data.items;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6 max-md:hidden">
        <h1 className="text-base font-semibold">手伝っているアカウント</h1>
        <span className="text-sm text-muted-foreground">{items.length}件 · 要確認の多い順</span>
      </header>
      <div className="space-y-3 p-4 md:p-6">
        {items.length === 0 ? (
          <p className="rounded-2xl border px-4 py-6 text-center text-sm text-muted-foreground">
            まだ手伝っているアカウントはありません。オーナーから招待リンクを受け取ると、ここに出ます。
          </p>
        ) : isWide ? (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {["アカウント", "要確認", "承認済み", "次の投稿", "伸び（直近7日）", "任された範囲", "担当"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 text-left font-normal first:pl-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.account.id} className="relative border-t hover:bg-accent/40">
                    <td className="px-3 py-3 pl-4">
                      {/* 行全体を押せるよう、リンクを行いっぱいに広げる */}
                      <Link
                        to={`/accounts/${item.account.id}`}
                        className="after:absolute after:inset-0"
                        aria-label={`${item.account.displayName ?? item.account.username}を開く`}
                      >
                        <AccountCell item={item} />
                      </Link>
                    </td>
                    <td className={item.needsReview > 0 ? "px-3 text-base font-semibold" : "px-3 text-muted-foreground"}>
                      {item.needsReview}
                    </td>
                    <td className="px-3">
                      <Approved item={item} />
                    </td>
                    <td className="px-3">
                      <NextPost item={item} />
                    </td>
                    <td className="px-3">
                      <Judgments item={item} />
                    </td>
                    <td className="px-3">
                      <Delegation item={item} />
                    </td>
                    <td className="px-3 text-[13px]">{editorNames(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.account.id}>
                <Link to={`/accounts/${item.account.id}`} className="block space-y-3 rounded-2xl border p-4 hover:bg-accent/40">
                  <AccountCell item={item} />
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">要確認</dt>
                      <dd className="font-semibold">{item.needsReview}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">承認済み</dt>
                      <dd>
                        <Approved item={item} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">次の投稿</dt>
                      <dd>
                        <NextPost item={item} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">伸び（直近7日）</dt>
                      <dd>
                        <Judgments item={item} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">任された範囲</dt>
                      <dd>
                        <Delegation item={item} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">担当</dt>
                      <dd>{editorNames(item)}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {summary.data.truncated && <p className="text-xs text-muted-foreground">表示しきれません（最初の100件を出しています）。</p>}
      </div>
    </div>
  );
}

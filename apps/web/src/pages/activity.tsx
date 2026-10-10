// 操作の記録（specs/008-team-operations contracts/ui-routes.md「操作の記録」、US4・FR-052）。
// オーナー・パートナーだけ。チームがあるAccountの、90日分の操作を新しい順に出す。
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ActivityItem } from "@threads-grower/shared";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useAccountAccess } from "@/lib/use-account-access";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/pages/account-layout";

/** 種類のチップ（FR-052）。 */
const KINDS = [
  { value: "", label: "すべて" },
  { value: "review", label: "承認・却下" },
  { value: "draft", label: "投稿の案" },
  { value: "content", label: "設定・戦略" },
  { value: "member", label: "メンバー" },
] as const;

const ROLE_LABELS: Record<string, string> = { owner: "オーナー", partner: "パートナー", editor: "編集者", member: "メンバー" };

/**
 * 操作の文言（contracts/api.md「操作の記録のコード」）。
 * @param item - 記録の1行
 * @returns 「（名前）が」に続く文
 */
export function actionText(item: ActivityItem): string {
  const n = item.itemCount;
  const s = item.summary ?? "";
  switch (item.action) {
    case "drafts_registered":
      return `投稿の案を${n}件登録しました`;
    case "batch_undone":
      return `登録を取り消しました（${n}件）`;
    case "draft_edited":
      return item.details?.reopened ? "承認済みの案を直しました（要確認に戻りました）" : "投稿の案を直しました";
    case "drafts_deleted":
      return `投稿の案を${n}件削除しました`;
    case "drafts_approved":
      return `${n}件を承認しました`;
    case "drafts_rejected":
      return `${n}件を却下しました`;
    case "drafts_reopened":
      return `${n}件を要確認に戻しました`;
    case "drafts_requeued":
      return `${n}件をもう一度投稿の順に入れました`;
    case "draft_prioritized":
      return "次に投稿する案を選びました";
    case "strategy_saved":
      return "課題を保存しました";
    case "promotion_added":
      return "宣伝内容を追加しました";
    case "promotion_updated":
      return "宣伝内容を直しました";
    case "promotion_deleted":
      return "宣伝内容を削除しました";
    case "promotion_ratio_saved":
      return "宣伝投稿の割合を変えました";
    case "reference_post_added":
      return "参考投稿を追加しました";
    case "reference_post_updated":
      return "参考投稿を直しました";
    case "reference_post_deleted":
      return "参考投稿を削除しました";
    case "research_keyword_added":
      return "キーワードを追加しました";
    case "research_keyword_updated":
      return "キーワードを直しました";
    case "research_keyword_deleted":
      return "キーワードを削除しました";
    case "prompt_count_saved":
      return "プロンプトで作る件数を変えました";
    case "feedback_saved":
      return "改善メモを保存しました";
    case "schedule_saved":
      return "投稿のスケジュールを変えました";
    case "threads_checked":
      return "Threadsとの接続を確かめました";
    case "ng_word_added":
      return `NGワードを${n}語追加しました`;
    case "ng_word_deleted":
      return "NGワードを削除しました";
    case "core_rules_saved":
      return "投稿のルールを保存しました";
    case "partner_invite_created":
      return "パートナーの招待リンクを作りました";
    case "partner_invite_rotated":
      return "パートナーの招待リンクを作り直しました";
    case "partner_invite_canceled":
      return "パートナーの招待を取り消しました";
    case "partner_joined":
      return "パートナーとして参加しました";
    case "partner_removed":
      return "パートナーを外しました";
    case "delegation_changed":
      return "パートナーに任せる範囲を変えました";
    case "assignment_added":
      return `${s}さんをこのアカウントの担当にしました`;
    case "assignment_removed":
      return `${s}さんの担当を外しました`;
    case "editor_removed":
      return `${s}さんをチームから外しました`;
    default:
      return item.action;
  }
}

/**
 * 2行目に出す対象（投稿の書き出し・変更の内容など）。担当の操作は1行目に名前を含めるので出さない。
 * @param item - 記録の1行
 * @returns 対象。なければ空
 */
function targetText(item: ActivityItem): string {
  if (item.action.startsWith("assignment_") || item.action === "editor_removed") return "";
  if (item.action === "delegation_changed") {
    const after = (item.details?.after ?? {}) as { review?: boolean; settings?: boolean };
    return `承認・却下：${after.review ? "任せる" : "任せない"} ／ 設定：${after.settings ? "任せる" : "任せない"}`;
  }
  if (item.action === "drafts_rejected" && item.details?.note) return `理由：${String(item.details.note)} · ${item.summary ?? ""}`;
  return item.summary ?? "";
}

const dayFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const timeFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const ymd = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);

/**
 * 日付ごとのまとまりの見出し（「今日 · 10/9(金)」）。
 * @param iso - 時刻
 * @param now - 現在時刻
 * @returns 見出し
 */
function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const label = dayFormat.format(d).replace(/\((.)\)/, "($1)");
  return ymd(d) === ymd(now) ? `今日 · ${label}` : label;
}

/**
 * 操作の記録の1行。まとめての操作は押すと対象の書き出しを開く。
 * @param props - item：記録
 * @returns 行
 */
function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const excerpts = (item.details?.excerpts as string[] | undefined) ?? [];
  const expandable = item.itemCount > 1 && excerpts.length > 1;
  const target = targetText(item);
  const body = (
    <>
      <span className="w-11 shrink-0 pt-1 text-[13px] text-muted-foreground tabular-nums">{timeFormat.format(new Date(item.at))}</span>
      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
        {item.actor.name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 text-left leading-normal">
        <span>
          <span className="font-semibold">{item.actor.name}</span>
          <span className="text-xs text-muted-foreground">（{ROLE_LABELS[item.actor.role] ?? item.actor.role}）</span>が
          {actionText(item)}
        </span>
        {target && <span className="block truncate text-[13px] text-muted-foreground">{target}</span>}
      </span>
      {expandable && <ChevronDownIcon className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />}
    </>
  );
  return (
    <li className="border-t first:border-t-0">
      {expandable ? (
        <button type="button" aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 hover:bg-accent/50" onClick={() => setOpen((v) => !v)}>
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3">{body}</div>
      )}
      {expandable && open && (
        <ul className="space-y-1 px-4 pb-3 pl-[6.5rem] text-[13px] text-foreground/80">
          {excerpts.map((e, i) => (
            <li key={i} className="truncate">
              {e}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * 操作の記録の画面。activity の権限がなければAccountのホームへ移す。
 * @returns 画面
 */
export function ActivityPage() {
  const account = useCurrentAccount();
  const { access, can } = useAccountAccess(account.id);
  const [kind, setKind] = useState("");
  const [actor, setActor] = useState("");
  const list = useInfiniteQuery({
    queryKey: queryKeys.activity(account.id, kind, actor),
    queryFn: ({ pageParam }) => api.listActivity(account.id, { kind, actor, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: can("activity"),
  });
  if (access && !can("activity")) return <Navigate to={`/accounts/${account.id}`} replace />;

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const actors = list.data?.pages[0]?.actors ?? [];
  const now = new Date();
  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <>
      <PageHeader
        title="操作の記録"
        actions={
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="max-md:sr-only">人</span>
            <select
              aria-label="人で絞り込む"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              className="h-9 rounded-full border bg-background px-3 text-sm text-foreground"
            >
              <option value="">全員</option>
              {actors.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name}（{ROLE_LABELS[a.role] ?? a.role}）
                </option>
              ))}
            </select>
          </label>
        }
      />
      <PageBody className="space-y-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="種類で絞り込む">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                "h-9 rounded-full px-4 text-[13px]",
                kind === k.value ? "bg-foreground text-background" : "border hover:bg-accent",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        {list.isPending ? (
          <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        ) : items.length === 0 ? (
          <p className="rounded-2xl border px-4 py-6 text-center text-sm text-muted-foreground">まだ記録はありません。</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="space-y-1.5">
              <h2 className="text-[13px] font-semibold text-muted-foreground">{g.label}</h2>
              <ul className="rounded-2xl border">
                {g.items.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))
        )}
        {list.hasNextPage && (
          <Button variant="outline" className="rounded-full" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            続きを読む
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          記録は、チームで運用しているアカウントだけに、90日分残ります。オーナーとパートナーが見られます。
        </p>
      </PageBody>
    </>
  );
}

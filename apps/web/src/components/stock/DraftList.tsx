// 状態のタブごとの下書きの一覧（specs/003 US2・US3、specs/004 FR-011・FR-012、contracts/ui-routes.md）。
// 要確認：新しい登録が上、同じ登録の中は貼り付けた順（API の順のまま）。登録のまとまりごとに小見出しを挟む。
// 承認済み・却下：承認・却下した日時の新しい順（API の順のまま）。
import { REJECTED_LIST_MAX, type PostDraft } from "@threads-grower/shared";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import { APPROVED_TAB_NOTICE, STOCK_LIMIT_MESSAGE } from "./messages";
import type { StockTab } from "./StatusTabs";

type Group = { batchId: string; createdAt: string; drafts: PostDraft[] };

function groupByBatch(items: PostDraft[]): Group[] {
  const groups: Group[] = [];
  for (const d of items) {
    const last = groups.at(-1);
    if (last?.batchId === d.batchId) last.drafts.push(d);
    else groups.push({ batchId: d.batchId, createdAt: d.createdAt, drafts: [d] });
  }
  return groups;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-[15px] text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * タブごとの下書きの一覧。
 * @param props - tab：表示するタブ、items：下書き（API の順）、limit：要確認の上限、canGeneratePrompt：空の状態の文言の切り替え、
 *   total：そのタブの全件数（却下は500件までしか返らないため）、renderCard：1件のカード、
 *   onSelectBatch：登録のまとまりの下書きを選択に足す（要確認。FR-004a）
 * @returns 一覧
 */
export function DraftList({
  tab,
  items,
  limit,
  canGeneratePrompt,
  total,
  renderCard,
  onSelectBatch,
  failed = [],
  approvedNotice,
}: {
  tab: StockTab;
  items: PostDraft[];
  limit: number;
  canGeneratePrompt: boolean;
  total: number;
  renderCard: (draft: PostDraft) => ReactNode;
  failed?: PostDraft[];
  approvedNotice?: ReactNode;
  onSelectBatch?: (drafts: PostDraft[]) => void;
}) {
  if (tab === "approved") {
    return (
      <div className="space-y-3">
        <p className="px-1 text-[13px] text-muted-foreground">
          {approvedNotice ?? APPROVED_TAB_NOTICE}
        </p>
        {failed.length > 0 && (
          <section id="publish-failed" className="space-y-2" aria-label="投稿に失敗">
            <h3 className="text-sm font-medium">投稿に失敗（{failed.length}件）</h3>
            <ul className="space-y-2">{failed.map(renderCard)}</ul>
          </section>
        )}
        {items.length === 0 ? (
          <Empty>
            承認した下書きはまだありません。要確認のタブで内容を確かめて「承認」を押してください。
          </Empty>
        ) : (
          <ul className="space-y-2">{items.map(renderCard)}</ul>
        )}
      </div>
    );
  }
  if (tab === "rejected") {
    if (items.length === 0) return <Empty>却下した下書きはありません。</Empty>;
    return (
      <div className="space-y-3">
        <ul className="space-y-2">{items.map(renderCard)}</ul>
        {total > REJECTED_LIST_MAX && (
          <p className="px-1 text-center text-[13px] text-muted-foreground">
            新しい{REJECTED_LIST_MAX}件を表示しています
          </p>
        )}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <Empty>
        {canGeneratePrompt
          ? "まだ下書きがありません。上のプロンプトをChatGPTやClaudeに送り、返ってきた回答を下の欄に貼り付けてください。"
          : "まだ下書きがありません。投稿を「@@@」だけの行で区切って、下の欄に貼り付けてください。"}
      </Empty>
    );
  }
  return (
    <div className="space-y-5">
      {items.length >= limit && (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm"
        >
          {STOCK_LIMIT_MESSAGE}
        </p>
      )}
      {groupByBatch(items).map((g) => (
        <section
          key={g.batchId}
          aria-label={`${formatDateTime(g.createdAt)}に登録した${g.drafts.length}件`}
          className="space-y-2"
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 className="text-xs text-muted-foreground">
              {formatDateTime(g.createdAt)}に登録した{g.drafts.length}件
            </h3>
            {onSelectBatch && (
              <button
                type="button"
                className="min-h-8 text-xs text-ring underline"
                onClick={() => onSelectBatch(g.drafts)}
              >
                この{g.drafts.length}件を選択
              </button>
            )}
          </div>
          <ul className="space-y-2">{g.drafts.map(renderCard)}</ul>
        </section>
      ))}
    </div>
  );
}

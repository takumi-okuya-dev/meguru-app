// 要確認の下書きの一覧（specs/003 US2・US3、contracts/ui-routes.md「状態のタブと下書きの一覧」）。
// 新しい登録が上、同じ登録の中は貼り付けた順（API の順のまま）。登録のまとまりごとに小見出しを挟む。
import type { PostDraft } from "@threads-grower/shared";
import { useState, type ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import { STOCK_LIMIT_MESSAGE } from "./messages";
import { ThreadsLengthBar } from "./ThreadsLengthBar";

/** 「もっと見る」を出す目安（6行を超えそうな本文） */
const LONG_LINES = 6;
const LONG_CHARS = 180;

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

/**
 * 要確認の下書きの一覧。
 * @param props - items：下書き（API の順）、limit：要確認の上限、canGeneratePrompt：空の状態の文言の切り替え、
 *   renderControls：各下書きの左（選択）と右（メニュー）に出すもの（US3）
 * @returns 一覧
 */
export function DraftList({
  items,
  limit,
  canGeneratePrompt,
  renderControls,
}: {
  items: PostDraft[];
  limit: number;
  canGeneratePrompt: boolean;
  renderControls?: (draft: PostDraft) => { leading?: ReactNode; trailing?: ReactNode };
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-[15px] text-muted-foreground">
        {canGeneratePrompt
          ? "まだ下書きがありません。上のプロンプトをChatGPTやClaudeに送り、返ってきた回答を下の欄に貼り付けてください。"
          : "まだ下書きがありません。投稿を「@@@」だけの行で区切って、下の欄に貼り付けてください。"}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {items.length >= limit && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
          {STOCK_LIMIT_MESSAGE}
        </p>
      )}
      {groupByBatch(items).map((g) => (
        <section key={g.batchId} aria-label={`${formatDateTime(g.createdAt)}に登録した${g.drafts.length}件`} className="space-y-2">
          <h3 className="px-1 text-xs text-muted-foreground">
            {formatDateTime(g.createdAt)}に登録した{g.drafts.length}件
          </h3>
          <ul className="space-y-2">
            {g.drafts.map((d) => (
              <DraftItem key={d.id} draft={d} controls={renderControls?.(d)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DraftItem({ draft, controls }: { draft: PostDraft; controls?: { leading?: ReactNode; trailing?: ReactNode } }) {
  const [expanded, setExpanded] = useState(false);
  const long = draft.body.split("\n").length > LONG_LINES || draft.body.length > LONG_CHARS;
  return (
    <li className="flex gap-2 rounded-2xl border bg-card px-3 py-3 md:px-4">
      {controls?.leading}
      <div className="min-w-0 flex-1 space-y-2">
        <p className={`text-[15px] leading-relaxed break-words whitespace-pre-wrap ${expanded ? "" : "line-clamp-6"}`}>
          {draft.body}
        </p>
        {long && (
          <button type="button" className="text-[13px] text-ring underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "閉じる" : "もっと見る"}
          </button>
        )}
        <ThreadsLengthBar text={draft.body} />
      </div>
      {controls?.trailing}
    </li>
  );
}

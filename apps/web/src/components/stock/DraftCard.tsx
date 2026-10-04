// 下書き1件のカード（specs/004-review-approval contracts/ui-routes.md「下書きのカード」、docs/ui-design.md 型C）。
// 上から：選択・本文・ラベルの行・長さの表示・タブごとの操作。
import type { PostDraft, PublishCheck } from "@threads-grower/shared";
import { rejectReasonLabel } from "@threads-grower/shared";
import { EllipsisIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/format";
import { NOT_APPROVABLE_LIMIT, NOT_APPROVABLE_NG } from "./messages";
import { ThreadsLengthBar } from "./ThreadsLengthBar";

/** 「もっと見る」を出す目安（6行を超えそうな本文） */
const LONG_LINES = 6;
const LONG_CHARS = 180;

/**
 * 本文の最初の行を短くしたもの（読み上げ名に使う）。
 * @param body - 本文
 * @returns 20文字までの抜き出し
 */
export const excerpt = (body: string) => {
  const line = body.split("\n")[0] ?? "";
  return line.length > 20 ? `${line.slice(0, 20)}…` : line;
};

/** カードの操作。 */
export type DraftCardActions = {
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReopen: () => void;
};

/**
 * 却下理由の表示（「トーンが違う・内容が薄い / 語尾がきつい」）。
 * @param draft - 却下の下書き
 * @returns 表示用の文字列
 */
function rejectReasonText(draft: PostDraft): string {
  const labels = draft.rejectReasons.map(rejectReasonLabel).join("・");
  return [labels, draft.rejectNote].filter(Boolean).join(" / ");
}

/**
 * 下書き1件のカード。
 * @param props - draft：下書き、selected：選ばれているか、check：承認できるかの判定、
 *   labels：ラベルの行（類似度・NGワード・規約に注意）、body：本文の表示（強調つき。省略すると文字のまま）、
 *   busy：状態を変えている途中、actions：操作
 * @returns カード
 */
export function DraftCard({
  draft,
  selected,
  check,
  labels,
  body,
  busy = false,
  actions,
}: {
  draft: PostDraft;
  selected: boolean;
  check: PublishCheck;
  labels?: ReactNode;
  body?: ReactNode;
  busy?: boolean;
  actions: DraftCardActions;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = draft.body.split("\n").length > LONG_LINES || draft.body.length > LONG_CHARS;
  const name = `「${excerpt(draft.body)}」`;
  const notApprovable = check.ngWords.length > 0 ? NOT_APPROVABLE_NG : check.overThreadsLimit ? NOT_APPROVABLE_LIMIT : null;

  return (
    <li id={`draft-${draft.id}`} className="flex gap-2 rounded-2xl border bg-card px-3 py-3 transition-shadow md:px-4">
      {/* タッチ操作でも押しやすいよう、押せる範囲を44px角にする */}
      <label className="-my-1.5 -ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center md:size-9">
        <input
          type="checkbox"
          className="size-4 accent-foreground"
          aria-label={`${name}を選択`}
          checked={selected}
          onChange={actions.onToggle}
        />
      </label>
      <div className="min-w-0 flex-1 space-y-2">
        <p className={`text-[15px] leading-relaxed break-words whitespace-pre-wrap ${expanded ? "" : "line-clamp-6"}`}>
          {body ?? draft.body}
        </p>
        {long && (
          <button type="button" className="text-[13px] text-ring underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "閉じる" : "もっと見る"}
          </button>
        )}
        {labels}
        <ThreadsLengthBar text={draft.body} />
        {draft.status === "needs_review" && (
          <div className="space-y-1">
            <div className="flex gap-2 md:justify-end">
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-full md:h-8 md:flex-none md:px-4"
                aria-label={`${name}を却下`}
                disabled={busy}
                onClick={actions.onReject}
              >
                却下
              </Button>
              <Button
                className="h-11 flex-1 rounded-full md:h-8 md:flex-none md:px-4"
                aria-label={`${name}を承認`}
                disabled={busy || notApprovable !== null}
                onClick={actions.onApprove}
              >
                承認
              </Button>
            </div>
            {notApprovable && <p className="text-[13px] text-muted-foreground md:text-right">{notApprovable}</p>}
          </div>
        )}
        {draft.status === "approved" && draft.reviewedAt && (
          <p className="text-[13px] text-muted-foreground">{formatDateTime(draft.reviewedAt)}に承認</p>
        )}
        {draft.status === "rejected" && (
          <div className="space-y-0.5 text-[13px] text-muted-foreground">
            {draft.reviewedAt && <p>{formatDateTime(draft.reviewedAt)}に却下</p>}
            <p>却下理由：{rejectReasonText(draft)}</p>
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="-my-1.5 -mr-1.5 size-11 shrink-0 text-muted-foreground md:size-8"
            aria-label={`${name}の操作`}
          >
            <EllipsisIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {draft.status !== "rejected" && <DropdownMenuItem onSelect={actions.onEdit}>編集</DropdownMenuItem>}
          {draft.status !== "needs_review" && <DropdownMenuItem onSelect={actions.onReopen}>要確認に戻す</DropdownMenuItem>}
          {draft.status !== "approved" && (
            <DropdownMenuItem className="text-destructive" onSelect={actions.onDelete}>
              削除
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// 低調の投稿の傾向メモと「プロンプトに入れる」（specs/006-performance-feedback FR-021・FR-022、contracts/ui-routes.md）。
// 保存ボタンはなく、メモは入力欄から離れたとき（変わっていれば）、切り替えは押したときに保存する。
import { useMutation } from "@tanstack/react-query";
import {
  FEEDBACK_MEMO_MAX,
  PERFORMANCE_MESSAGES,
  staleUpdateTitle,
  type FeedbackResponse,
  type PerformanceItem,
} from "@threads-grower/shared";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api-client";
import { isStale } from "@/lib/save-error";

/**
 * プロンプトに入るかどうかの説明（FR-022）。
 * @param feedback - 改善フィードバック
 * @returns 説明の文
 */
export function promptNote(feedback: NonNullable<PerformanceItem["feedback"]>): string {
  if (!feedback.includeInPrompt) return "外しています。以降のプロンプトには入りません";
  if (feedback.inNextPrompt) return "次のプロンプトに入ります";
  return "新しい5件に入っていないため、今は入りません";
}

/**
 * 傾向メモの入力欄と切り替え。
 * @param props - accountId：AccountのID、item：低調の投稿、onSaved：保存できたとき（一覧を合わせる）
 * @returns 入力欄
 */
export function FeedbackEditor({
  accountId,
  item,
  onSaved,
}: {
  accountId: string;
  item: PerformanceItem;
  onSaved: (res: FeedbackResponse) => void;
}) {
  const feedback = item.feedback!;
  const id = useId();
  const [memo, setMemo] = useState(feedback.memo ?? "");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    // 読み込んだ版を送り、他の人が先に保存していたら 409 にする（specs/008 FR-007）
    mutationFn: (body: { memo?: string | null; includeInPrompt?: boolean }) =>
      api.updateFeedback(accountId, item.id, { ...body, expectedVersion: feedback.version }),
    onSuccess: (res) => {
      onSaved(res);
      setSaved(true);
    },
  });
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  const commitMemo = () => {
    const next = memo.trim();
    if (next === (feedback.memo ?? "")) return;
    save.mutate({ memo: next === "" ? null : next });
  };

  return (
    <div className="flex flex-col gap-2 border-t pt-2.5">
      <label htmlFor={id} className="text-sm font-semibold">
        傾向メモ<span className="font-normal text-muted-foreground">（任意・なぜ伸びなかったと思うか）</span>
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={FEEDBACK_MEMO_MAX}
        placeholder="例：前置きが長く、結論が最後まで出てこない"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        onBlur={commitMemo}
        className="w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-[18px] accent-foreground"
            checked={feedback.includeInPrompt}
            disabled={save.isPending}
            onChange={() => save.mutate({ includeInPrompt: !feedback.includeInPrompt })}
          />
          プロンプトに入れる
        </label>
        <span className="text-xs text-muted-foreground">{promptNote(feedback)}</span>
        {saved && <span className="text-xs text-muted-foreground">保存しました</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          {[...memo].length}/{FEEDBACK_MEMO_MAX}
        </span>
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          {isStale(save.error)
            ? `${staleUpdateTitle(save.error.updatedBy?.name)}。画面を読み込み直してから、もう一度保存してください。`
            : PERFORMANCE_MESSAGES.feedbackSaveFailed}
        </p>
      )}
    </div>
  );
}

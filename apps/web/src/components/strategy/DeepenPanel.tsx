// 「AIと深掘り」の欄（specs/014-strategy-guidance FR-031〜FR-035、contracts/ui-routes.md「課題」）。
// プロンプトをコピーし、AIの答えを貼り付けて、反映する内容（目印の内側か全体）を入力欄に入れる。保存はしない。
import { STRATEGY_TEXT_MAX, countChars, extractFinal, FINAL_BEGIN } from "@threads-grower/shared";
import { useEffect, useId, useState } from "react";
import { CopyPromptButton } from "@/components/CopyPromptButton";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

/**
 * AIと深掘りする欄。
 * @param props - getPrompt：プロンプトを作る（画面の今の入力から）、onApply：反映する内容を入力欄に入れる、
 *   onClose：閉じる（まだ反映していない答えがあれば、親が破棄してよいか確かめる）、
 *   onDirtyChange：まだ反映していない答えがあるか（PR #17 のCodexレビュー）、steps：手順の文（省略は深掘りの3つの手順）
 * @returns 欄
 */
export function DeepenPanel({
  getPrompt,
  onApply,
  onClose,
  onDirtyChange,
  steps = [
    "「プロンプトをコピーする」を押す",
    "ChatGPTやClaudeに貼り付けて送り、AIの質問に答える",
    "AIが出した完成版を、答えごと下に貼り付けて「この内容を反映する」",
  ],
}: {
  getPrompt: () => string;
  onApply: (text: string) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  steps?: string[];
}) {
  const [paste, setPaste] = useState("");
  const pasteId = useId();
  // まだ反映していない答えは、閉じる・切り替え・画面の移動の前に確かめる（PR #17 のCodexレビュー）
  const dirty = paste.trim() !== "";
  useUnsavedChanges(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const extracted = extractFinal(paste);
  const over = countChars(extracted.text) > STRATEGY_TEXT_MAX;

  return (
    <div className="space-y-3 rounded-2xl border px-4 py-3.5 text-sm leading-relaxed">
      <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <CopyPromptButton getText={getPrompt} />
      <div className="space-y-1">
        <label htmlFor={pasteId} className="font-medium">
          AIの答えを貼り付ける
        </label>
        <textarea
          id={pasteId}
          rows={6}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="AIが返した答えを、そのまま丸ごと貼り付けてください"
          className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-[14px]"
        />
      </div>
      {extracted.text !== "" && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {extracted.marked
              ? `反映する内容（目印「${FINAL_BEGIN}」の内側）`
              : "目印が見つからないので、貼り付けた文の全体を反映します"}
          </p>
          <div className="rounded-xl bg-muted/60 px-3 py-2 whitespace-pre-wrap">{extracted.text}</div>
          {over && (
            <p className="text-[13px] text-warning">
              {STRATEGY_TEXT_MAX}文字を超えています。反映した後に短くしてください
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-10 rounded-full px-4" disabled={extracted.text === ""} onClick={() => onApply(extracted.text)}>
          この内容を反映する
        </Button>
        <Button type="button" variant="ghost" className="h-10 rounded-full px-4" onClick={onClose}>
          閉じる
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">反映しても、まだ保存されません。上の「保存」で保存します。</p>
    </div>
  );
}

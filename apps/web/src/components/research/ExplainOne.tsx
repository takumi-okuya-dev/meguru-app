// 参考投稿の編集の画面の「AIに解説してもらう」（1件の解説。specs/014-strategy-guidance FR-086）。
// 解説のプロンプトをコピーし、返ってきた解説を貼り付けて「なぜ良いか」の欄に入れる（保存は編集の「保存」で）。
import { useEffect, useId, useState } from "react";
import { CopyPromptButton } from "@/components/CopyPromptButton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/**
 * 1件の解説の欄。
 * @param props - accountId、postId：参考投稿、onUse：貼り付けた解説を「なぜ良いか」に入れる、
 *   onDirtyChange：貼り付けた解説があるか（編集の画面を閉じる前の確認に使う。PR #17 のCodexレビュー）
 * @returns 欄
 */
export function ExplainOne({
  accountId,
  postId,
  onUse,
  onDirtyChange,
}: {
  accountId: string;
  postId: string;
  onUse: (text: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [paste, setPaste] = useState("");
  const pasteId = useId();
  const dirty = paste.trim() !== "";
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  return (
    <div className="mt-2 space-y-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
      <p className="font-medium">AIに「なぜ伸びたか」を解説してもらう</p>
      <p className="text-[13px] text-muted-foreground">
        プロンプトをコピーしてChatGPTやClaudeに送り、返ってきた解説を貼り付けます。画像の投稿なら、画像も一緒に送ってください。
      </p>
      <CopyPromptButton
        label="解説のプロンプトをコピーする"
        getText={async () => (await api.getExplainPrompt(accountId, postId)).prompt}
      />
      <label htmlFor={pasteId} className="block font-medium">
        解説を貼り付ける
      </label>
      <textarea
        id={pasteId}
        rows={3}
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder="AIが返した解説を、そのまま貼り付けてください"
        className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-[13px]"
      />
      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-full px-4"
        disabled={paste.trim() === ""}
        onClick={() => {
          onUse(paste.trim());
          setPaste("");
        }}
      >
        なぜ良いかに入れる
      </Button>
    </div>
  );
}

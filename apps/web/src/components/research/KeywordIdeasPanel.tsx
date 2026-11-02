// 検索するキーワードの案をAIに出してもらう（specs/014-strategy-guidance US9、FR-090〜FR-092）。
// プロンプトをコピーし、AIの答えを貼ると1行ずつチェック付きの一覧にし、選んだものをまとめて登録する。
import { useMutation } from "@tanstack/react-query";
import {
  KEYWORD_BATCH_MAX,
  parseKeywordIdeas,
  type KeywordIdeaProblem,
} from "@threads-grower/shared";
import { useId, useState } from "react";
import { toast } from "sonner";
import { CopyPromptStatus, CopyPromptTrigger, useCopyPrompt } from "@/components/CopyPromptButton";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { billingReasonOf, isBillingRequired, saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

const PROBLEM_LABELS: Record<KeywordIdeaProblem, string> = {
  too_long: "長すぎます（100文字まで）",
  registered: "登録済みです",
  duplicate: "一覧の中で重なっています",
};

/**
 * キーワードの案の欄。直せる人だけに置く。
 * @param props - accountId、registered：登録済みのキーワード、remaining：あと何件登録できるか、
 *   onSaved：登録した後（重なり・上限で登録できなかったときも一覧を読み直す）、onBillingRequired：読むだけになった、
 *   readOnly：読むだけになった後（貼り付けた内容は残し、コピーと登録はできない。PR #17 のCodexレビュー）
 * @returns 欄
 */
export function KeywordIdeasPanel({
  accountId,
  registered,
  remaining,
  onSaved,
  onBillingRequired,
  readOnly = false,
}: {
  accountId: string;
  registered: string[];
  remaining: number;
  onSaved: () => void;
  onBillingRequired: (reason: string) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const pasteId = useId();
  const ideas = paste.trim() === "" ? [] : parseKeywordIdeas(paste, registered);
  // 貼り付けた案を選んでいる途中で画面を移ろうとしたら、確かめる（PR #17 のCodexレビュー）
  useUnsavedChanges(paste.trim() !== "");
  const picked = ideas.filter((idea, i) => idea.problem === null && !unchecked.has(i));
  const cap = Math.min(remaining, KEYWORD_BATCH_MAX);

  const save = useMutation({
    mutationFn: () =>
      api.createKeywordsBatch(accountId, {
        items: picked.map(({ keyword, purpose }) => ({ keyword, purpose })),
      }),
    onSuccess: () => {
      toast.success(`${picked.length}件のキーワードを登録しました`);
      setPaste("");
      setUnchecked(new Set());
      setFailure(null);
      setOpen(false);
      onSaved();
    },
    onError: (err) => {
      if (isBillingRequired(err)) onBillingRequired(billingReasonOf(err) ?? "");
      else if (err instanceof ApiError && err.code === "KEYWORD_DUPLICATE") {
        setFailure(`すでに登録されているキーワードがあります：${err.details.join("、")}`);
        onSaved();
      } else if (err instanceof ApiError && err.code === "ITEM_LIMIT_REACHED") {
        setFailure(saveErrorMessage(err));
        onSaved();
      } else toast.error(saveErrorMessage(err));
    },
  });

  const toggle = (i: number) =>
    setUnchecked((set) => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // 結果の文は、説明とボタンの行の下に出す（行の中に出すと、ボタンが下の行へ押し出される）
  const prompt = useCopyPrompt({
    getText: async () => (await api.getKeywordIdeaPrompt(accountId)).prompt,
    onCopied: () => setOpen(true),
  });
  return (
    <section
      aria-label="何を検索すればいいか迷ったら"
      className="mb-3 space-y-3 rounded-2xl border bg-muted/30 px-4 py-3.5 text-sm"
    >
      {/* 狭い画面では、説明が細い縦の列にならないよう、ボタンを下の行へ回す */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <p className="font-medium">何を検索すればいいか迷ったら</p>
          <p className="text-xs text-muted-foreground">
            課題をもとに、検索する言葉の案をAIに出してもらえます
          </p>
        </div>
        {!readOnly && (
          <CopyPromptTrigger
            label="AIにキーワードの案を出してもらう"
            disabled={prompt.loading}
            onClick={() => void prompt.copy()}
          />
        )}
      </div>
      <CopyPromptStatus
        state={prompt.state}
        copiedMessage="プロンプトをコピーしました。ChatGPTやClaudeに貼り付けて送り、返ってきた答えをまるごと下に貼り付けてください"
      />
      {open && (
        <div className="space-y-2.5">
          <label htmlFor={pasteId} className="font-medium">
            AIの答えを貼り付ける
          </label>
          <textarea
            id={pasteId}
            rows={5}
            value={paste}
            // 登録の途中は変えられない（登録の後に欄を空にするので、後から貼った案を失わないように）
            disabled={save.isPending || readOnly}
            onChange={(e) => {
              setPaste(e.target.value);
              setUnchecked(new Set());
              setFailure(null);
            }}
            placeholder="「キーワード｜狙い」の行を、そのまま丸ごと貼り付けてください"
            className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-[14px]"
          />
          {ideas.length > 0 && (
            <ul className="space-y-1.5">
              {ideas.map((idea, i) => {
                const ok = idea.problem === null;
                return (
                  <li key={i}>
                    <label className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        disabled={!ok || save.isPending || readOnly}
                        checked={ok && !unchecked.has(i)}
                        onChange={() => toggle(i)}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium break-words">{idea.keyword}</span>
                        {idea.purpose && (
                          <span className="text-[13px] text-muted-foreground">{idea.purpose}</span>
                        )}
                        {idea.problem && (
                          <span className="self-start rounded-full bg-warning-bg px-2 text-[11px] font-medium text-warning">
                            {PROBLEM_LABELS[idea.problem]}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {failure && (
            <p role="alert" className="text-[13px] text-warning">
              {failure}
            </p>
          )}
          {ideas.length > 0 && !readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="h-10 rounded-full px-4"
                disabled={picked.length === 0 || picked.length > cap || save.isPending}
                onClick={() => save.mutate()}
              >
                {picked.length}件を登録する
              </Button>
              {picked.length > cap && (
                <span className="text-[13px] text-warning">
                  {remaining < KEYWORD_BATCH_MAX
                    ? `キーワードはあと${remaining}件まで登録できます`
                    : `1回に登録できるのは${KEYWORD_BATCH_MAX}件までです`}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// 解説がまだの参考投稿を、まとめてAIに解説してもらう（specs/014-strategy-guidance US8、FR-100〜FR-105）。
// 最大10件分のプロンプトをコピーし、AIの答えを1回貼り付けると【ID】で参考投稿に結び付け、選んだ分を保存する。
import { useMutation } from "@tanstack/react-query";
import { EXPLAIN_BATCH_MAX, isBlank, parseExplanations, type ExplanationProblem, type ReferencePost } from "@meguru/shared";
import { useId, useState } from "react";
import { toast } from "sonner";
import { CopyPromptStatus, CopyPromptTrigger, useCopyPrompt } from "@/apps/threads/components/CopyPromptButton";
import { Button } from "@/components/ui/button";
import { threadsApi } from "@/apps/threads/lib/api";
import { billingReasonOf, isBillingRequired, saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

const PROBLEM_LABELS: Record<ExplanationProblem, string> = {
  not_found: "対応する参考投稿が見つかりません",
  already_explained: "すでに解説があります",
  duplicate: "同じIDが2回あります",
  empty: "解説が空です",
  too_long: "長すぎます",
};

const excerpt = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return [...flat].length > n ? `${[...flat].slice(0, n).join("")}…` : flat;
};

/**
 * まとめての解説の欄。直せる人で、解説がまだの参考投稿があるときだけ置く。
 * @param props - accountId、posts：そのアカウントの参考投稿、onSaved：保存した後、onBillingRequired：読むだけになった、
 *   readOnly：読むだけになった後（貼り付けた内容は残し、コピーと保存はできない。PR #17 のCodexレビュー）
 * @returns 欄
 */
export function ExplainBatchPanel({
  accountId,
  posts,
  onSaved,
  onBillingRequired,
  readOnly = false,
}: {
  accountId: string;
  posts: ReferencePost[];
  onSaved: () => void;
  onBillingRequired: (reason: string) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [skippedCount, setSkippedCount] = useState(0);
  const pasteId = useId();
  const pending = posts.filter((p) => isBlank(p.whyGood)).length;
  const batchCount = Math.min(pending, EXPLAIN_BATCH_MAX);
  const parsed = paste.trim() === "" ? [] : parseExplanations(paste, posts);
  // 貼り付けた答えを選んでいる途中で画面を移ろうとしたら、確かめる（PR #17 のCodexレビュー）
  useUnsavedChanges(paste.trim() !== "");
  const picked = parsed.filter((r, i) => r.problem === null && !unchecked.has(i));

  const save = useMutation({
    mutationFn: () => threadsApi.saveExplanations(accountId, { items: picked.map((r) => ({ id: r.id!, whyGood: r.text })) }),
    onSuccess: (res) => {
      if (res.saved.length > 0) toast.success(`${res.saved.length}件の解説を保存しました`);
      setSkippedCount(res.skipped.length);
      setPaste("");
      setUnchecked(new Set());
      if (res.skipped.length === 0) setOpen(false);
      onSaved();
    },
    onError: (err) => {
      if (isBillingRequired(err)) onBillingRequired(billingReasonOf(err) ?? "");
      else toast.error(saveErrorMessage(err));
    },
  });

  // 結果の文は、説明とボタンの行の下に出す（行の中に出すと、ボタンが動く）
  const prompt = useCopyPrompt({
    getText: async () => (await threadsApi.getExplainPrompt(accountId, undefined)).prompt,
    onCopied: () => {
      setOpen(true);
      setSkippedCount(0);
    },
  });

  // 貼り付けた答えが残っている間は、ほかの人が解説を入れて0件になっても欄を消さない（PR #17 のCodexレビュー）
  if (pending === 0 && skippedCount === 0 && paste.trim() === "") return null;

  return (
    // 「投稿をつくる」の「解説がまだ」から #explain で移ってくる（specs/014 FR-122）
    <section
      id="explain"
      aria-label="まとめてAIに解説してもらう"
      className="scroll-mt-28 space-y-3 rounded-2xl border bg-muted/30 px-4 py-3.5 text-sm"
    >
      {/* 狭い画面では、説明が細い縦の列にならないよう、ボタンを下の行へ回す */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <p className="font-medium">解説がまだの参考投稿：{pending}件</p>
          <p className="text-xs text-muted-foreground">
            「なぜ伸びたか」をAIにまとめて解説してもらうと、投稿づくりに活かせます（1回に{EXPLAIN_BATCH_MAX}件まで）
          </p>
        </div>
        {pending > 0 && !readOnly && (
          <CopyPromptTrigger
            label={`まとめてAIに解説してもらう（${batchCount}件）`}
            disabled={prompt.loading}
            onClick={() => void prompt.copy()}
          />
        )}
      </div>
      <CopyPromptStatus
        state={prompt.state}
        copiedMessage={`${batchCount}件分のプロンプトをコピーしました。ChatGPTやClaudeに貼り付けて送り、返ってきた答えをまるごと下に貼り付けてください`}
      />
      {skippedCount > 0 && (
        <p role="status" className="text-[13px] text-warning">
          {skippedCount}件は、ほかで解説が入っていたため保存しませんでした
        </p>
      )}
      {open && (
        <div className="space-y-2.5">
          <label htmlFor={pasteId} className="font-medium">
            AIの答えを貼り付ける
          </label>
          <textarea
            id={pasteId}
            rows={6}
            value={paste}
            // 保存の途中は変えられない（保存の後に欄を空にするので、後から貼った答えを失わないように）
            disabled={save.isPending || readOnly}
            onChange={(e) => {
              setPaste(e.target.value);
              setUnchecked(new Set());
            }}
            placeholder="AIが返した答えを、そのまま丸ごと貼り付けてください"
            className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-[14px]"
          />
          {parsed.length > 0 && (
            <ul className="space-y-1.5">
              {parsed.map((r, i) => {
                const post = posts.find((p) => p.id === r.id);
                const ok = r.problem === null;
                return (
                  <li key={i}>
                    <label className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        disabled={!ok || save.isPending || readOnly}
                        checked={ok && !unchecked.has(i)}
                        onChange={() =>
                          setUnchecked((set) => {
                            const next = new Set(set);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs text-muted-foreground">参考投稿：{post ? excerpt(post.body, 40) : "（不明）"}</span>
                        {r.problem && (
                          <span className="self-start rounded-full bg-warning-bg px-2 text-[11px] font-medium text-warning">
                            {PROBLEM_LABELS[r.problem]}
                          </span>
                        )}
                        <span className="text-[13px] break-words whitespace-pre-wrap">{excerpt(r.text, 120)}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {parsed.length > 0 && !readOnly && (
            <Button
              type="button"
              className="h-10 rounded-full px-4"
              disabled={picked.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {picked.length}件の解説を保存する
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

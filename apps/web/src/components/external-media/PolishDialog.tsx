// 「AIと整える」のポップアップ（specs/021 FR-012a、research.md R3）。018の「AIと考える」と同じく、プロンプトをコピーし、答えを貼って反映する。
// 反映したあとの自動の直しとルールのチェックは、画面と保存で通す。アプリの中ではAIを呼ばない（原則III）。
import { MEDIA_LABELS, parsePolishAnswer, polishPrompt, type ListingSource, type ListingValues, type Media } from "@threads-grower/shared";
import { useId, useState } from "react";
import { CopyPromptStatus, CopyPromptTrigger, useCopyPrompt } from "@/components/CopyPromptButton";
import { FormDialogFrame } from "@/components/items/FormDialogFrame";

const STEPS = ["プロンプトをコピーして、ChatGPTやClaudeに送る", "返ってきた答えを、下に丸ごと貼り付ける", "タイトルと本文の案を確かめて「反映する」"];

/**
 * 「AIと整える」。
 * @param props - media：媒体、source：材料、values：今の欄の値、onApply：タイトル・本文を入れる、onRequestClose：閉じる
 * @returns ポップアップ
 */
export function PolishDialog({
  media,
  source,
  values,
  onApply,
  onRequestClose,
}: {
  media: Media;
  source: ListingSource;
  values: ListingValues;
  onApply: (patch: { title: string | null; body: string | null }) => void;
  onRequestClose: () => void;
}) {
  const [paste, setPaste] = useState("");
  const pasteId = useId();
  const copy = useCopyPrompt({ getText: () => polishPrompt(media, source, values) });
  const parsed = parsePolishAnswer(paste);
  const found = parsed.title !== null || parsed.body !== null;
  return (
    <FormDialogFrame
      title={`AIと整える（${MEDIA_LABELS[media]}）`}
      description="タイトルと本文の言い回しを、ChatGPTやClaudeと整えます"
      submitLabel="反映する"
      submitting={false}
      submitDisabled={!found}
      onSubmit={() => onApply(parsed)}
      onRequestClose={onRequestClose}
    >
      <div className="space-y-4 text-sm leading-relaxed">
        <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="space-y-2">
          <CopyPromptTrigger disabled={copy.loading} onClick={() => void copy.copy()} />
          <CopyPromptStatus state={copy.state} copiedMessage="コピーしました。ChatGPTやClaudeに貼り付けて送ってください" />
        </div>
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
        {paste.trim() !== "" && !found && (
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm">
            「【タイトル】」「【本文】」の目印が見つかりませんでした。AIに『決まった形で出してください』と送り、出た答えを貼ってください
          </p>
        )}
        {found && (
          <div className="space-y-2" aria-label="反映する案">
            {parsed.title !== null && (
              <div className="space-y-0.5 rounded-xl border px-3 py-2">
                <span className="text-[12px] text-muted-foreground">タイトル</span>
                <p className="text-[13px]">{parsed.title}</p>
              </div>
            )}
            {parsed.body !== null && (
              <div className="space-y-0.5 rounded-xl border px-3 py-2">
                <span className="text-[12px] text-muted-foreground">本文</span>
                <p className="text-[13px] whitespace-pre-wrap">{parsed.body}</p>
              </div>
            )}
            <p className="text-[12px] text-muted-foreground">反映しても、まだ保存されません。媒体のルールに合わない行は、自動で外します。</p>
          </div>
        )}
      </div>
    </FormDialogFrame>
  );
}

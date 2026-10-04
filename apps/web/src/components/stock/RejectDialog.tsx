// 却下理由の入力（specs/004-review-approval FR-003・FR-029・FR-040、contracts/ui-routes.md「却下理由の入力」）。
// 理由は必須（Constitution原則II）。よくある理由の候補を選ぶだけでも確定できる。
import { REJECT_NOTE_MAX, REJECT_REASONS, countChars, isBlank, type RejectReasonCode } from "@threads-grower/shared";
import { useState } from "react";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { FormDialogFrame } from "@/components/items/FormDialogFrame";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";

/**
 * 却下理由の入力のダイアログ。
 * @param props - count：却下する件数、initialReasons：最初から選んでおく候補（似た投稿・規約に注意）、
 *   submitting：送信中、onSubmit：確定、onClose：閉じる
 * @returns ダイアログ
 */
export function RejectDialog({
  count,
  initialReasons = [],
  submitting,
  onSubmit,
  onClose,
}: {
  count: number;
  initialReasons?: RejectReasonCode[];
  submitting: boolean;
  onSubmit: (reject: { reasons: RejectReasonCode[]; note: string }) => void;
  onClose: () => void;
}) {
  const [reasons, setReasons] = useState<RejectReasonCode[]>(initialReasons);
  const [note, setNote] = useState("");
  // 自由記述を書きかけのときは、移動の前に警告する（FR-032）
  useUnsavedChanges(!isBlank(note));
  const empty = reasons.length === 0 && isBlank(note);
  const tooLong = countChars(note) > REJECT_NOTE_MAX;

  const toggle = (code: RejectReasonCode) =>
    setReasons((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const submit = () => {
    if (empty || tooLong || submitting) return;
    // 候補の並びは REJECT_REASONS の順にそろえる
    onSubmit({ reasons: REJECT_REASONS.map((r) => r.code).filter((c) => reasons.includes(c)), note: note.trim() });
  };

  return (
    <FormDialogFrame
      title={count === 1 ? "却下の理由" : `${count}件を却下する理由`}
      description="理由は次のプロンプトに「繰り返さないこと」として入ります"
      submitLabel="却下する"
      submitting={submitting || empty || tooLong}
      onSubmit={submit}
      onRequestClose={onClose}
    >
      <p className="text-[13px] text-muted-foreground">理由は次のプロンプトに「繰り返さないこと」として入ります</p>
      <div role="group" aria-label="よくある理由" className="flex flex-wrap gap-2">
        {REJECT_REASONS.map((r) => {
          const on = reasons.includes(r.code);
          return (
            <button
              key={r.code}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(r.code)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm md:min-h-9",
                on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <FieldWithCounter
        id="reject-note"
        label="自由記述"
        requiredNote="任意"
        placeholder="例：語尾がきつい"
        rows={2}
        max={REJECT_NOTE_MAX}
        value={note}
        onChange={setNote}
      />
      {empty && <p className="text-[13px] text-warning">理由を1つ以上選ぶか、書いてください</p>}
    </FormDialogFrame>
  );
}

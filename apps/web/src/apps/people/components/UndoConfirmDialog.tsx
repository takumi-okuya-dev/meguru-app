// 取り込みの取り消し・イベントを消すの確かめ（specs/people/001-people-memo contracts/ui-routes.md 1、research.md R14）。
// 消える回答と人の数、書き足しのある人（メモ・声かけなど）の一覧を出し、その人たちを残すか消すかを選ばせる。
import type { ImportUndoPreview, PersonNote, UndoResult } from "@meguru/shared/people";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ApiError, describeError } from "@/lib/api-client";

/** 書き足しの名前。 */
const NOTE_LABELS: Record<PersonNote, string> = {
  memo: "メモ",
  outreach: "声かけ",
  manual_consent: "手で直した同意",
  manual_attendance: "手で足した会ったイベント",
  sales: "タグ・次にやること・連絡の記録など",
};

/** 確かめに出す中身（イベントを消すときは、取り込みの数と声かけの数も）。 */
export type UndoPreviewData = ImportUndoPreview & { importCount?: number; outreachCount?: number };

/**
 * 取り消し・消すの確かめのダイアログ。
 * @param props - title：見出し、confirmLabel：決めるボタンの文言、queryKey・queryFn：確かめの中身を読む、
 *   run：取り消す・消す（書き足しのある人を残すか。いなければ undefined）、onDone：終わったとき、onCancel：やめる
 * @returns ダイアログ
 */
export function UndoConfirmDialog({
  title,
  confirmLabel,
  queryKey,
  queryFn,
  run,
  onDone,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  queryKey: readonly unknown[];
  queryFn: () => Promise<UndoPreviewData>;
  run: (keepPeopleWithNotes: boolean | undefined) => Promise<UndoResult>;
  onDone: (result: UndoResult) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const preview = useQuery({ queryKey, queryFn, staleTime: 0 });
  const [keep, setKeep] = useState<boolean | null>(null);
  const withNotes = preview.data?.peopleWithNotes ?? [];
  const mutation = useMutation({
    mutationFn: () => run(withNotes.length > 0 ? (keep ?? undefined) : undefined),
    onSuccess: onDone,
    onError: (err) => {
      // 確かめのあとで書き足しのある人が増えた：中身を読み直して選び直してもらう
      if (err instanceof ApiError && err.code === "PEOPLE_CONFIRM_REQUIRED") {
        setKeep(null);
        void preview.refetch();
      }
    },
  });
  const needsChoice = withNotes.length > 0 && keep === null;
  const p = preview.data;
  return (
    <ConfirmDialog
      title={title}
      confirmLabel={confirmLabel}
      destructive
      pending={!p || needsChoice || mutation.isPending}
      error={preview.isError ? describeError(preview.error) : mutation.isError ? describeError(mutation.error) : null}
      onConfirm={() => mutation.mutate()}
      onCancel={onCancel}
    >
      {!p ? (
        <p>読み込んでいます…</p>
      ) : (
        <>
          <p className="font-medium">元に戻せません。</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {p.importCount !== undefined && <li>取り込み {p.importCount}件を取り消します</li>}
            <li>回答 {p.responseCount}件が消えます</li>
            <li>
              ほかの会に来ていない人 {withNotes.length > 0 ? p.removedPeopleCount - withNotes.length : p.removedPeopleCount}人が消えます
              {withNotes.length > 0 && <>（下の書き足しのある人 {withNotes.length}人は、選んだとおりに残すか消す）</>}
            </li>
            {p.outreachCount !== undefined && p.outreachCount > 0 && <li>この会への声かけ {p.outreachCount}件が消えます</li>}
          </ul>
          {withNotes.length > 0 && (
            <fieldset className="space-y-2 rounded-xl border p-3">
              <legend className="px-1 font-medium">書き足しのある人（{withNotes.length}人）</legend>
              <ul className="space-y-0.5">
                {withNotes.map((n) => (
                  <li key={n.personId}>
                    {n.displayName}
                    <span className="text-muted-foreground">（{n.notes.map((x) => NOTE_LABELS[x]).join("・")}）</span>
                  </li>
                ))}
              </ul>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name={`${id}-keep`} className="size-4" checked={keep === true} onChange={() => setKeep(true)} />
                この人たちは残す（回答なしで残ります）
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name={`${id}-keep`} className="size-4" checked={keep === false} onChange={() => setKeep(false)} />
                この人たちも消す
              </label>
            </fieldset>
          )}
        </>
      )}
    </ConfirmDialog>
  );
}

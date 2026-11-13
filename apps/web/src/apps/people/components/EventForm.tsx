// イベントの入力欄（名前・開催日・自分の会か）。作る画面・取り込みの「作る」・イベントのページの「直す」で使う
// （specs/people/001-people-memo contracts/ui-routes.md 1）。
import { jstToday } from "@meguru/shared";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { EventInput } from "../lib/api";

/** 入力欄の見た目（スマートフォンは16px以上の文字・44px以上の高さ）。 */
export const fieldClass = "h-11 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:text-[15px]";

/**
 * イベントの入力欄。
 * @param props - initial：初めの値、submitLabel：決めるボタンの文言、pending：処理中、error：失敗の文言、onSubmit：決めたとき、onCancel：やめる（省略するとボタンを出さない）
 * @returns 入力欄
 */
export function EventForm({
  initial,
  submitLabel,
  pending = false,
  error = null,
  onSubmit,
  onCancel,
}: {
  initial?: EventInput;
  submitLabel: string;
  pending?: boolean;
  error?: string | null;
  onSubmit: (input: EventInput) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [heldOn, setHeldOn] = useState(initial?.heldOn ?? jstToday(new Date()));
  const [isOwn, setIsOwn] = useState(initial?.isOwn ?? true);
  const [nameError, setNameError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    onSubmit({ name: name.trim(), heldOn, isOwn });
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          イベントの名前
        </label>
        <input
          id={`${id}-name`}
          className={fieldClass}
          value={name}
          maxLength={100}
          placeholder="例：11月25日 IT交流会"
          aria-invalid={nameError}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(false);
          }}
        />
        {nameError && <p className="text-[13px] text-destructive">名前を入れてください</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-date`} className="text-sm font-medium">
          開催日
        </label>
        <input id={`${id}-date`} type="date" required className={fieldClass} value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={isOwn} onChange={(e) => setIsOwn(e.target.checked)} />
        自分の会（自分が開いたイベント）
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" className="h-11 rounded-full md:h-10" onClick={onCancel}>
            キャンセル
          </Button>
        )}
        <Button type="submit" className="h-11 rounded-full md:h-10" disabled={pending || heldOn === ""}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

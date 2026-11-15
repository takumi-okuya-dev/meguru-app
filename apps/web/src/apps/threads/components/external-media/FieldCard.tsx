// 入力の画面の欄のカード（specs/021 FR-010・FR-011、contracts/ui-routes.md 3）。
// 欄の名前・必須・登録後に変えられない・文字数・コピー・入力・媒体の画面での名前と説明・選ぶ欄の選択肢と理由・タイトルのほかの案。
import { countChars, type MediaField } from "@meguru/shared";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { CopyValueButton } from "./CopyValueButton";

/**
 * 欄のカード。
 * @param props - field：欄、value：値、mediaLabel：媒体の名前、reason：選んだ理由、candidates：タイトルのほかの案、
 *   canEdit：直せるか、onChange：値を変える
 * @returns カード
 */
export function FieldCard({
  field,
  value,
  mediaLabel,
  reason,
  candidates = [],
  canEdit,
  onChange,
}: {
  field: MediaField;
  value: string;
  mediaLabel: string;
  reason?: string;
  candidates?: readonly string[];
  canEdit: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const len = countChars(value);
  const over = field.max !== undefined && len > field.max;
  return (
    <div className="space-y-1.5 rounded-xl border px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="min-w-40 flex-1 font-medium">
          {field.label}
          {field.required && <span className="ml-1.5 text-[11px] text-destructive">必須</span>}
          {field.immutable && <span className="ml-1.5 rounded-full bg-warning-bg px-1.5 text-[11px] text-warning">登録後は変更不可</span>}
          {field.max !== undefined && (
            <span className={cn("ml-1.5 text-[12px] font-normal tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
              {len} / {field.max}文字
            </span>
          )}
        </label>
        <CopyValueButton text={value} label={field.label} />
      </div>
      {field.kind === "select" && field.options ? (
        <div id={id} role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-1.5">
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={value === o}
              disabled={!canEdit}
              onClick={() => onChange(o)}
              className={cn(
                "rounded-full border px-3 py-1 text-[13px]",
                value === o ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      ) : field.kind === "textarea" ? (
        <textarea
          id={id}
          rows={Math.min(12, Math.max(3, value.split("\n").length))}
          value={value}
          readOnly={!canEdit}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-y rounded-lg border border-input bg-card px-2.5 py-2 text-[13px] leading-relaxed"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          readOnly={!canEdit}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]"
        />
      )}
      <p className="text-[12px] text-muted-foreground">
        {mediaLabel}の入力欄：「{field.label}」{field.kind === "select" ? "（選択肢から選びます）" : ""}
        {field.help ? `。${field.help}` : ""}
      </p>
      {reason && value && <p className="text-[12px] text-muted-foreground">このイベントでは「{value}」を選びます。{reason}</p>}
      {candidates.length > 0 && (
        <div className="space-y-1">
          <p className="text-[12px] text-muted-foreground">ほかの案（押すと入れ替えます）</p>
          <ul className="flex flex-col gap-1">
            {candidates.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onChange(c)}
                  className="w-full rounded-lg bg-muted/60 px-2.5 py-1.5 text-left text-[13px] hover:bg-accent"
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

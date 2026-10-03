// ラベル・説明・未入力・文字数つきの入力欄（docs/ui-design.md 型A、specs/002 contracts/ui-routes.md 規則9）。
// 各項目に出すのは、ラベル・1行の説明・入力欄（記入例は空の欄の中）・文字数だけにする。
import { countChars, isBlank } from "@threads-grower/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** FieldWithCounter の引数。 */
export type FieldWithCounterProps = {
  id: string;
  label: string;
  /** 1行の説明 */
  description?: string;
  /** 記入例（空の欄の中に薄く出す。保存しない） */
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** 文字数の上限 */
  max: number;
  /** 複数行の入力欄にするか（既定は true） */
  multiline?: boolean;
  rows?: number;
  readOnly?: boolean;
  /** 必須の項目なら、ラベルの横に添える文言（例：「必須」） */
  requiredNote?: string;
  /** 空のときに「未入力」の小さなラベルを出すか（課題の項目） */
  showEmptyBadge?: boolean;
  /** 入力欄の下に出す案内（必須の未入力・URLの形など） */
  error?: string;
  /** 入力欄の下に出す、注意ではない補足（掲載期限が過去など） */
  hint?: string;
  type?: "text" | "url";
  className?: string;
};

/**
 * ラベル・説明・未入力・文字数つきの入力欄。上限を超えたら注意の色にして案内を出す（入力内容は消さない）。
 * @param props - 入力欄の設定
 * @returns 入力欄
 */
export function FieldWithCounter({
  id,
  label,
  description,
  placeholder,
  value,
  onChange,
  max,
  multiline = true,
  rows = 3,
  readOnly = false,
  requiredNote,
  showEmptyBadge = false,
  error,
  hint,
  type = "text",
  className,
}: FieldWithCounterProps) {
  const count = countChars(value);
  const over = count > max;
  const message = over ? `${max}文字以内で入力してください` : error;
  const describedBy = [description && `${id}-desc`, message && `${id}-msg`].filter(Boolean).join(" ") || undefined;
  const fieldClass = cn(over || error ? "border-warning focus-visible:ring-warning" : undefined);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {requiredNote && <span className="text-xs text-muted-foreground">{requiredNote}</span>}
        {showEmptyBadge && isBlank(value) && (
          <span className="rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">未入力</span>
        )}
      </div>
      {description && (
        <p id={`${id}-desc`} className="text-[13px] text-muted-foreground">
          {description}
        </p>
      )}
      <div className="relative pt-1">
        {multiline ? (
          <Textarea
            id={id}
            rows={rows}
            value={value}
            placeholder={placeholder}
            readOnly={readOnly}
            aria-invalid={over || !!error}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
            className={cn("resize-y pb-7", fieldClass)}
          />
        ) : (
          <Input
            id={id}
            type={type}
            value={value}
            placeholder={placeholder}
            readOnly={readOnly}
            aria-invalid={over || !!error}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
            className={cn("h-11 rounded-xl bg-card pr-16 text-base md:h-10 md:text-[15px]", fieldClass)}
          />
        )}
        <span
          className={cn(
            "pointer-events-none absolute right-3 text-[11px] tabular-nums",
            multiline ? "bottom-2" : "top-1/2 -translate-y-1/2 pt-1",
            over ? "font-medium text-warning" : "text-muted-foreground",
          )}
        >
          {count}/{max}
        </span>
      </div>
      {message && (
        <p id={`${id}-msg`} className="text-[13px] text-warning">
          {message}
        </p>
      )}
      {!message && hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

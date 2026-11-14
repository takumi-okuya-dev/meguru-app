// 媒体・料金の区分を選ぶボタンの列（名簿の入力。specs/collect/001-event-day-collection FR-020・FR-021）。
import { Button } from "@/components/ui/button";

/**
 * 1つを選ぶボタンの列。
 * @param props - label：見出し（読み上げ用）、options：選べる値と表示名、value：選んでいる値、onChange：選んだとき
 * @returns ボタンの列
 */
export function ChoiceButtons<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          variant={o.value === value ? "default" : "outline"}
          size="sm"
          className="h-9 rounded-full px-3"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

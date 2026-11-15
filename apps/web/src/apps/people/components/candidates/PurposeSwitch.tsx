// 誘う候補の目的の切り替え（交流会への誘い／仕事の相談先へのつなぎ。specs/people/001-people-memo contracts/ui-routes.md 1）。
import type { OutreachPurpose } from "@meguru/shared/people";
import { cn } from "@/lib/utils";
import { CONSENT_KEYS, CONSENT_LABELS } from "../person/labels";

/**
 * 目的の切り替え。
 * @param props - value：今の目的、onChange：選んだとき
 * @returns 切り替え
 */
export function PurposeSwitch({ value, onChange }: { value: OutreachPurpose; onChange: (purpose: OutreachPurpose) => void }) {
  return (
    <div role="group" aria-label="目的" className="grid grid-cols-2 gap-1 rounded-full border bg-muted p-1">
      {CONSENT_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          className={cn(
            "min-h-11 rounded-full px-3 text-sm leading-tight md:min-h-9",
            value === k ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(k)}
        >
          {CONSENT_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

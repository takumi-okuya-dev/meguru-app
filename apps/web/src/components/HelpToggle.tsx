// 閉じたトグルの説明（docs/ui-design.md：説明は閉じたトグルに箇条書き）。チームの画面と運用状況の画面で使う（specs/020）。
import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 押すと箇条書きの説明が開くトグル（「ロールについて」と同じ見た目）。
 * @param props - label：ボタンの文字、points：箇条書き
 * @returns トグル
 */
export function HelpToggle({ label, points }: { label: string; points: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] hover:bg-accent"
      >
        <ChevronRightIcon
          className={cn("size-4 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        {label}
      </button>
      {open && (
        <ul
          id={panelId}
          aria-label={label}
          className="space-y-0.5 rounded-2xl bg-muted/60 px-4 py-3.5 text-[13px] leading-relaxed text-foreground/80"
        >
          {points.map((p) => (
            <li key={p}>・{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

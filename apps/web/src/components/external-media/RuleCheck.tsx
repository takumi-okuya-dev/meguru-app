// ルールのチェックの枠（specs/021 FR-020・FR-021、contracts/ui-routes.md 3）。赤・黄・参考の件数と項目、閉じたトグル「自動で直した内容」。
import type { ListingCheck, ListingFix } from "@threads-grower/shared";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

const LEVEL = {
  red: { label: "赤", word: "直す", badge: "bg-destructive/10 text-destructive" },
  yellow: { label: "黄", word: "確認", badge: "bg-warning-bg text-warning" },
  info: { label: "参考", word: "参考", badge: "bg-muted text-muted-foreground" },
} as const;

/**
 * 赤・黄・参考の件数の印。
 * @param props - checks：項目
 * @returns 印の並び
 */
export function RuleCounts({ checks }: { checks: readonly ListingCheck[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {(["red", "yellow", "info"] as const).map((lv) => (
        <span key={lv} className={cn("rounded-full px-2 text-[11px] font-semibold", LEVEL[lv].badge)}>
          {LEVEL[lv].label} {checks.filter((c) => c.level === lv).length}
        </span>
      ))}
    </span>
  );
}

/**
 * ルールのチェックの枠。
 * @param props - checks：項目、fixes：自動で直した内容
 * @returns 枠
 */
export function RuleCheck({ checks, fixes }: { checks: readonly ListingCheck[]; fixes: readonly ListingFix[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section aria-label="ルールのチェック" className="space-y-2 rounded-2xl border px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2 font-medium">
        ルールのチェック
        <RuleCounts checks={checks} />
      </div>
      <ul className="space-y-1 text-[13px] leading-relaxed">
        {checks.map((c, i) => (
          <li key={i}>
            <span className={cn("mr-1.5 font-semibold", c.level === "red" ? "text-destructive" : c.level === "yellow" ? "text-warning" : "text-muted-foreground")}>
              {LEVEL[c.level].word}
            </span>
            {c.message}
          </li>
        ))}
      </ul>
      {fixes.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-muted px-2.5 text-[12px] hover:bg-accent"
          >
            <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
            自動で直した内容（{fixes.length}件）
          </button>
          {open && (
            <ul id={panelId} aria-label="自動で直した内容" className="space-y-1.5 rounded-xl bg-muted/60 px-3.5 py-3 text-[12px] leading-relaxed">
              {fixes.map((f, i) => (
                <li key={i}>
                  外した行「{f.excerpt}」<span className="text-muted-foreground">…{f.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

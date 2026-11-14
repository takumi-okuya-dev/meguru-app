// 課題の区分へ移るチップの並び（specs/014-strategy-guidance FR-017〜FR-019、research.md R5）。
// 上部バーの下に固定し（PC・スマートフォンとも）、区分ごとの「十分」の数と、今見ている区分を出す。
import { STRATEGY_SECTIONS, STRATEGY_TOTAL, type StrategyCheck, type StrategySectionId } from "@meguru/shared";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 区分の見出しの要素の id。
 * @param id - 区分の ID
 * @returns 要素の id
 */
export const sectionElementId = (id: string) => `strategy-${id}`;

/**
 * 今見ている区分を、区分の要素の位置から決める。IntersectionObserver がなければ最初の区分のまま。
 * @returns 今の区分と、押したときに今の区分を変える関数
 */
function useCurrentSection(): [StrategySectionId, (id: StrategySectionId) => void] {
  const [current, setCurrent] = useState<StrategySectionId>(STRATEGY_SECTIONS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const elements = STRATEGY_SECTIONS.map((s) => document.getElementById(sectionElementId(s.id))).filter(
      (el): el is HTMLElement => el !== null,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0];
        if (!top) return;
        const section = STRATEGY_SECTIONS.find((s) => sectionElementId(s.id) === top.target.id);
        if (section) setCurrent(section.id);
      },
      // 固定の上部バーとチップの下から、画面の上半分にある区分を「今」とみなす
      { rootMargin: "-120px 0px -55% 0px" },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [current, setCurrent];
}

/**
 * 区分へ移るチップの並び。
 * @param props - check：自動チェックの結果
 * @returns チップの並び
 */
export function SectionChips({ check }: { check: StrategyCheck }) {
  const [current, setCurrent] = useCurrentSection();
  const go = (id: StrategySectionId) => {
    setCurrent(id);
    document.getElementById(sectionElementId(id))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  return (
    <nav aria-label="区分へ移動" className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2 md:px-5">
      {/* スマートフォンの幅では、上部バーに出せない完了と要確認の数をここに出す（FR-017） */}
      <span className="shrink-0 text-[13px] md:hidden">完了{check.done}/{STRATEGY_TOTAL}</span>
      {check.review > 0 && <span className="shrink-0 text-[13px] text-warning md:hidden">要確認{check.review}</span>}
      {STRATEGY_SECTIONS.map((s) => {
        const counts = check.sections[s.id];
        const complete = counts !== null && counts.done === counts.total;
        const on = current === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={on ? "true" : undefined}
            onClick={() => go(s.id)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm whitespace-nowrap md:h-8 md:text-[13px]",
              on ? "bg-foreground text-background" : "bg-muted hover:bg-accent",
            )}
          >
            {s.chip}
            {counts && <span className="opacity-75">{complete ? "✓" : `${counts.done}/${counts.total}`}</span>}
          </button>
        );
      })}
    </nav>
  );
}

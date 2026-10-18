// 考えるヒント（specs/014-strategy-guidance FR-001〜FR-004、contracts/ui-routes.md「課題」）。
// 「考えるヒント」のボタンで開閉し、コツ・悪い例と良い例・3つの問いを出す。開いたかどうかは保存しない。
import type { StrategyHint } from "@threads-grower/shared";
import { LightbulbIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 考えるヒントのボタンと中身。
 * @param props - hint：項目のヒント（なければボタンを出さない）、actions：ボタンの横に並べる操作、
 *   below：ヒントの下に出す中身（AIと深掘りする欄など）、className：外側の追加のクラス
 * @returns 考えるヒント
 */
export function HintPanel({
  hint,
  actions,
  below,
  className,
}: {
  hint: StrategyHint | null;
  actions?: ReactNode;
  below?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-2">
        {hint && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] hover:bg-accent"
          >
            <LightbulbIcon className="size-4" aria-hidden="true" />
            考えるヒント{open ? "（閉じる）" : ""}
          </button>
        )}
        {actions}
      </div>
      {hint && open && (
        <div id={panelId} className="space-y-3 rounded-2xl bg-muted/60 px-4 py-3.5 text-sm leading-relaxed">
          <p>
            <span className="font-medium">コツ：</span>
            {hint.tip}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border bg-card px-3 py-2">
              <div className="text-xs font-medium text-warning">✕ 悪い例</div>
              <div>{hint.bad}</div>
            </div>
            <div className="rounded-xl border bg-card px-3 py-2">
              <div className="text-xs font-medium text-success">○ 良い例</div>
              <div>{hint.good}</div>
            </div>
          </div>
          <div>
            <div className="font-medium">もっとこんな内容も足してみたら？</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {hint.more.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium">こんな場合はどうだろう？</div>
            <p>{hint.whatIf}</p>
          </div>
          <div>
            <div className="font-medium">もっと良くするなら、ここを考えてみて</div>
            <p>{hint.better}</p>
          </div>
        </div>
      )}
      {below}
    </div>
  );
}

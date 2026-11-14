// 下書きを選んでいるときの操作のバー（specs/003 US3、specs/004 FR-004）。投稿ストックの画面の下に固定する。
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** 下書きを選んでいるときの状態と操作。actions はタブごとの操作のボタン。 */
export type DraftSelection = { count: number; onClear: () => void; actions: ReactNode };

/**
 * 選択のバー。
 * @param props - selection：選んでいる件数と操作
 * @returns 選択のバー
 */
export function SelectionBar({ selection }: { selection: DraftSelection }) {
  return (
    <div className="pt-2 pb-3">
      <div
        role="toolbar"
        aria-label="選んだ下書きの操作"
        className="flex flex-wrap items-center gap-2 rounded-3xl border bg-card py-2 pr-2 pl-4 shadow-sm"
      >
        <span className="min-w-0 flex-1 text-sm font-medium">{selection.count}件を選択中</span>
        <Button variant="ghost" className="h-10 rounded-full md:h-9" onClick={selection.onClear}>
          選択を解除
        </Button>
        {selection.actions}
      </div>
    </div>
  );
}

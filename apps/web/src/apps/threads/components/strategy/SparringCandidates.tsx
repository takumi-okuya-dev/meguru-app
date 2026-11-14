// 壁打ちの答えから読み取った、反映の候補の一覧（specs/018-strategy-ai-sparring FR-015〜FR-018、contracts/ui-routes.md 5）。
// 見た目は参考投稿の「まとめてAIに解説してもらう」の候補の一覧（ExplainBatchPanel）にそろえる。
import { STRATEGY_TEXT_MAX, type SparringCandidate, type SparringKey } from "@meguru/shared";

/**
 * 反映の候補の一覧。各行に、選ぶ印・今の入力・新しい案を縦に並べる。
 * @param props - candidates：候補（表示の順）、selected：選んだ項目、onToggle：選ぶ印を押したとき
 * @returns 一覧
 */
export function SparringCandidates({
  candidates,
  selected,
  onToggle,
}: {
  candidates: SparringCandidate[];
  selected: ReadonlySet<SparringKey>;
  onToggle: (key: SparringKey) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {candidates.map((c) => (
        <li key={c.key} className="space-y-2 rounded-xl border bg-card px-3 py-2">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={selected.has(c.key)} onChange={() => onToggle(c.key)} />
            <span className="font-medium">{c.label}</span>
          </label>
          {(c.same || c.over) && (
            <div className="flex flex-wrap gap-1.5 pl-7">
              {c.same && (
                <span className="rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">今と同じ</span>
              )}
              {c.over && (
                <span className="rounded-full bg-warning-bg px-2 text-[11px] font-medium text-warning">
                  {STRATEGY_TEXT_MAX}文字を超えています。反映した後に短くしてください
                </span>
              )}
            </div>
          )}
          <div className="space-y-1 pl-7">
            <p className="text-xs text-muted-foreground">今</p>
            <p className="max-h-24 overflow-y-auto rounded-lg bg-muted/60 px-2.5 py-1.5 text-[13px] break-words whitespace-pre-wrap text-muted-foreground">
              {c.current.trim() === "" ? "未入力" : c.current}
            </p>
            <p className="text-xs text-muted-foreground">新しい案</p>
            <p className="max-h-40 overflow-y-auto rounded-lg border px-2.5 py-1.5 text-[13px] break-words whitespace-pre-wrap">
              {c.proposed}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

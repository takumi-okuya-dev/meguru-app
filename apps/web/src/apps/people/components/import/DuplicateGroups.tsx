// 同じCSVの中の重なり（同じLINE名の行の組。specs/people/001-people-memo spec Edge Cases、contracts/ui-routes.md 2）。
// どれか1行を残す（ほかは取り込まない）か、全部を別の人として入れるかを選ぶ。残す行に同じ人の候補があれば、残してつなぐこともできる。
import type { ImportPreviewRow } from "@meguru/shared/people";
import { Button } from "@/components/ui/button";
import { choiceClass, RowFields, type Decide } from "./CandidateCards";
import type { DecisionMap } from "./import-state";

/**
 * 同じCSVの中の重なりの組（1組）。
 * @param props - rows：組の行、decisions：行ごとの決め、linkedElsewhere：ほかの行でつないでいる人、onDecide：決めたとき（この組の決めだけを渡す）
 * @returns 組のカード
 */
export function DuplicateGroup({
  rows,
  decisions,
  linkedElsewhere,
  onDecide,
}: {
  rows: ImportPreviewRow[];
  decisions: DecisionMap;
  linkedElsewhere: ReadonlySet<string>;
  onDecide: Decide;
}) {
  const allNew = rows.every((r) => decisions.get(r.row)?.action === "new");
  // 1行を残し（つなぐ人を渡せばつなぐ）、ほかを取り込まない
  const keepOne = (keep: number, personId?: string) =>
    onDecide(
      new Map(
        rows.map((r) => [
          r.row,
          r.row === keep ? (personId ? { action: "link" as const, personId } : { action: "new" as const }) : { action: "skip" as const },
        ]),
      ),
    );
  return (
    <article aria-label="同じCSVの中の同じLINE名" className="space-y-3 rounded-2xl border bg-card p-4" data-testid="duplicate-group">
      <h4 className="text-sm font-medium">同じCSVの中に、同じLINE名の行が{rows.length}つあります</h4>
      <div className="flex flex-col gap-3 md:flex-row">
        {rows.map((r) => {
          const d = decisions.get(r.row);
          const kept = !allNew && d !== undefined && d.action !== "skip";
          return (
            <section key={r.row} className="flex-1 space-y-2 rounded-xl border p-3">
              <h5 className="text-xs font-medium text-muted-foreground">{r.row + 2}行目</h5>
              <RowFields row={r} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={kept && d?.action === "new" ? "default" : "outline"}
                  className={choiceClass(kept && d?.action === "new")}
                  aria-pressed={kept && d?.action === "new"}
                  onClick={() => keepOne(r.row)}
                >
                  この行を残す
                </Button>
                {(r.candidates ?? []).map((c) => {
                  const selected = kept && d?.action === "link" && d.personId === c.personId;
                  return (
                    <Button
                      key={c.personId}
                      variant={selected ? "default" : "outline"}
                      className={choiceClass(selected)}
                      aria-pressed={selected}
                      disabled={linkedElsewhere.has(c.personId)}
                      onClick={() => keepOne(r.row, c.personId)}
                    >
                      この行を残して{c.displayName}さんにつなぐ
                    </Button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button
          variant={allNew ? "default" : "outline"}
          className={choiceClass(allNew)}
          aria-pressed={allNew}
          onClick={() => onDecide(new Map(rows.map((r) => [r.row, { action: "new" as const }])))}
        >
          全部、別の人として入れる
        </Button>
      </div>
    </article>
  );
}

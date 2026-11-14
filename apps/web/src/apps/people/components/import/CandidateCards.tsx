// 同じ人の候補のカード（specs/people/001-people-memo contracts/ui-routes.md 2、US2）。
// 左に取り込む行、右に候補の人（同じ項目＋来たイベント・理由）。「つなぐ」「別の人」。候補が2人以上なら、人ごとに「この人につなぐ」。
// スマートフォンでは上下に積む。
import type { ImportCandidate, ImportPreviewRow } from "@meguru/shared/people";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatHeldOn } from "../format";
import type { DecisionMap } from "./import-state";
import { answerItems, FieldList } from "./PersonFields";

/** 候補の理由の言葉。 */
const REASON_LABELS: Record<ImportCandidate["reasons"][number], string> = {
  line_name: "LINE名が同じ",
  line_name_loose: "記号を除くとLINE名が同じ",
  real_name: "本名が同じ",
};

/** 決めたときの処理。 */
export type Decide = (decisions: DecisionMap) => void;

/**
 * 候補の人の中身。
 * @param props - candidate：候補の人
 * @returns 中身
 */
export function CandidateFields({ candidate: c }: { candidate: ImportCandidate }) {
  return (
    <FieldList
      items={[
        { label: "名前", value: c.displayName },
        { label: "LINE名", value: [c.lineName, ...c.otherLineNames.map((n) => `${n}（前の名前）`)].filter(Boolean).join("、") },
        { label: "本名", value: c.realName },
        ...answerItems(c.latestAnswers),
        { label: "来たイベント", value: c.recentEvents.map((e) => `${e.name}（${formatHeldOn(e.heldOn)}）`).join("、") },
        { label: "理由", value: c.reasons.map((r) => REASON_LABELS[r]).join("・") },
      ]}
    />
  );
}

/**
 * 取り込む行の中身。
 * @param props - row：取り込む行
 * @returns 中身
 */
export function RowFields({ row }: { row: ImportPreviewRow }) {
  return (
    <FieldList
      items={[{ label: "LINE名", value: row.lineName ?? null }, { label: "本名", value: row.realName ?? null }, ...answerItems(row.answers)]}
    />
  );
}

/**
 * 選ぶボタンの見た目（選んだものに枠を付ける）。
 * @param selected - 選んでいるか
 * @returns クラス
 */
export const choiceClass = (selected: boolean) => cn("h-11 rounded-full md:h-9", selected && "ring-2 ring-ring");

/**
 * 同じ人の候補のカード（1組）。
 * @param props - row：候補の行、decisions：行ごとの決め、linkedElsewhere：ほかの行でつないでいる人、onDecide：決めたとき（この組の決めだけを渡す）
 * @returns カード
 */
export function CandidateCard({
  row,
  decisions,
  linkedElsewhere,
  onDecide,
}: {
  row: ImportPreviewRow;
  decisions: DecisionMap;
  linkedElsewhere: ReadonlySet<string>;
  onDecide: Decide;
}) {
  const candidates = row.candidates ?? [];
  const current = decisions.get(row.row);
  const many = candidates.length >= 2;
  const link = (personId: string) => onDecide(new Map([[row.row, { action: "link", personId }]]));
  const linkLabel = many ? "この人につなぐ" : "つなぐ";
  return (
    <article aria-label={`${row.lineName ?? ""}の候補`} className="space-y-3 rounded-2xl border bg-card p-4" data-testid="candidate-card">
      <div className="flex flex-col gap-3 md:flex-row">
        <section className="flex-1 space-y-2 rounded-xl bg-muted/50 p-3">
          <h4 className="text-xs font-medium text-muted-foreground">取り込む行（{row.row + 2}行目）</h4>
          <RowFields row={row} />
        </section>
        <div className="flex flex-1 flex-col gap-3">
          {candidates.map((c) => {
            const selected = current?.action === "link" && current.personId === c.personId;
            const taken = linkedElsewhere.has(c.personId);
            return (
              <section key={c.personId} className="space-y-2 rounded-xl border p-3">
                <h4 className="text-xs font-medium text-muted-foreground">同じ人の候補</h4>
                <CandidateFields candidate={c} />
                {many && (
                  <Button
                    variant={selected ? "default" : "outline"}
                    className={choiceClass(selected)}
                    aria-pressed={selected}
                    disabled={taken}
                    onClick={() => link(c.personId)}
                  >
                    {linkLabel}
                  </Button>
                )}
                {taken && <p className="text-xs text-muted-foreground">ほかの行でこの人につないでいます</p>}
              </section>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {!many && candidates[0] && (
          <Button
            variant={current?.action === "link" ? "default" : "outline"}
            className={choiceClass(current?.action === "link")}
            aria-pressed={current?.action === "link"}
            disabled={linkedElsewhere.has(candidates[0].personId)}
            onClick={() => link(candidates[0]!.personId)}
          >
            {linkLabel}
          </Button>
        )}
        <Button
          variant={current?.action === "new" ? "default" : "outline"}
          className={choiceClass(current?.action === "new")}
          aria-pressed={current?.action === "new"}
          onClick={() => onDecide(new Map([[row.row, { action: "new" }]]))}
        >
          別の人
        </Button>
      </div>
    </article>
  );
}

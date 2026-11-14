// 取り込む行と候補の人の中身（LINE名・本名・次回参加・欲しいつながり・キャリアの興味）。候補のカードと重なりの組で使う。
import type { AnswerSummary } from "@meguru/shared/people";
import type { ReactNode } from "react";

/** 1行の項目。 */
type Item = { label: string; value: ReactNode };

/**
 * 項目の並び。空の値は「—」。
 * @param props - items：項目
 * @returns 項目の並び
 */
export function FieldList({ items }: { items: Item[] }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
      {items.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value === null || value === undefined || value === "" ? "—" : value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 答えの項目（次回参加・欲しいつながり・キャリアの興味）。
 * @param answers - 答えの要約
 * @returns 項目
 */
export function answerItems(answers: AnswerSummary | null | undefined): Item[] {
  return [
    { label: "次回参加", value: answers?.nextAttendance ?? null },
    { label: "欲しいつながり", value: answers?.wantedConnections.join("、") ?? null },
    { label: "キャリアの興味", value: answers?.careerInterests.join("、") ?? null },
  ];
}

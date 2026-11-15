// 取り込みの④確かめ（specs/people/001-people-memo contracts/ui-routes.md 2、FR-006）。
// 新しく入る人・同じ人の候補・取り込めない行（理由ごと）・もう取り込んだ行・消した人の行の数と、候補の組・重なりの組を出す。
// すべての組を決めるまで「取り込む」は押せない。スマートフォンでは1組ずつ進む（決めたら次の決めていない組へ）。
import type { ImportPreview } from "@meguru/shared/people";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CandidateCard } from "./CandidateCards";
import { DuplicateGroup } from "./DuplicateGroups";
import { confirmCounts, decisionGroups, groupDecided, groupRows, INVALID_REASON_LABELS, type DecisionGroup, type DecisionMap } from "./import-state";

/**
 * ほかの組でつないでいる人。
 * @param g - この組
 * @param decisions - 行ごとの決め
 * @returns 人のID
 */
function linkedOutside(g: DecisionGroup, decisions: DecisionMap): Set<string> {
  const mine = new Set(groupRows(g));
  return new Set([...decisions.entries()].filter(([row, d]) => !mine.has(row) && d.action === "link").map(([, d]) => d.personId!));
}

/**
 * 取り込みの確かめの段。
 * @param props - preview：プレビュー、decisions：行ごとの決め、onDecisions：決めが変わったとき、
 *   oneAtATime：1組ずつ出す（スマートフォン）、index・onIndex：1組ずつのときの今の組、notice：上に出す知らせ、
 *   pending：取り込み中、error：失敗の文言、onBack：列の対応へ戻る、onCommit：取り込む
 * @returns 確かめの段
 */
export function ConfirmStep({
  preview,
  decisions,
  onDecisions,
  oneAtATime,
  index,
  onIndex,
  notice,
  pending,
  error,
  onBack,
  onCommit,
}: {
  preview: ImportPreview;
  decisions: DecisionMap;
  onDecisions: (next: DecisionMap) => void;
  oneAtATime: boolean;
  index: number;
  onIndex: (i: number) => void;
  notice: string | null;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onCommit: () => void;
}) {
  const counts = confirmCounts(preview);
  const groups = decisionGroups(preview);
  const decidedCount = groups.filter((g) => groupDecided(g, decisions)).length;
  const allDecided = decidedCount === groups.length;
  const importable = counts.newCount + counts.candidateCount + preview.rows.filter((r) => r.status === "duplicate_in_file").length;
  const at = Math.min(index, Math.max(groups.length - 1, 0));
  const shown = oneAtATime ? groups.slice(at, at + 1) : groups;

  const decide = (part: DecisionMap) => {
    const next = new Map(decisions);
    for (const [row, d] of part) next.set(row, d);
    onDecisions(next);
    if (oneAtATime) {
      // 次の決めていない組へ進む（なければそのまま）
      const following = groups.findIndex((x, i) => i > at && !groupDecided(x, next));
      const anyLeft = following >= 0 ? following : groups.findIndex((x) => !groupDecided(x, next));
      if (anyLeft >= 0 && anyLeft !== at) onIndex(anyLeft);
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <p role="status" className="rounded-xl border bg-warning-bg px-3 text-warning py-2 text-sm">
          {notice}
        </p>
      )}
      <section aria-labelledby="confirm-counts" className="space-y-2">
        <h3 id="confirm-counts" className="text-sm font-medium text-muted-foreground">
          取り込む前に確かめてください
        </h3>
        <ul className="divide-y rounded-2xl border bg-card text-sm">
          <CountRow label="新しく入る人" value={`${counts.newCount}人`} />
          <CountRow label="同じ人の候補" value={`${counts.candidateCount}組`} />
          {counts.duplicateGroupCount > 0 && <CountRow label="同じCSVの中の同じLINE名" value={`${counts.duplicateGroupCount}組`} />}
          {counts.invalid.map((x) => (
            <CountRow key={x.reason} label={`取り込めない行（${INVALID_REASON_LABELS[x.reason]}）`} value={`${x.count}件`} />
          ))}
          {counts.alreadyImported > 0 && <CountRow label="もう取り込んだ行" value={`${counts.alreadyImported}件`} />}
          {counts.erased > 0 && <CountRow label="消した人の行（取り込みません）" value={`${counts.erased}件`} />}
        </ul>
      </section>

      {groups.length > 0 && (
        <section aria-labelledby="confirm-groups" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="confirm-groups" className="text-sm font-medium">
              同じ人かどうかを選んでください
            </h3>
            <span className="text-sm text-muted-foreground tabular-nums">
              決めた組 {decidedCount} / {groups.length}
            </span>
          </div>
          {shown.map((g) =>
            g.kind === "candidate" ? (
              <CandidateCard
                key={g.key}
                row={g.row}
                decisions={decisions}
                linkedElsewhere={linkedOutside(g, decisions)}
                onDecide={decide}
              />
            ) : (
              <DuplicateGroup
                key={g.key}
                rows={g.rows}
                decisions={decisions}
                linkedElsewhere={linkedOutside(g, decisions)}
                onDecide={decide}
              />
            ),
          )}
          {oneAtATime && groups.length > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" className="h-11 rounded-full" disabled={at === 0} onClick={() => onIndex(at - 1)}>
                <ChevronLeftIcon /> 前の組
              </Button>
              <span className="text-sm tabular-nums">
                {at + 1}組目 / 全{groups.length}組
              </span>
              <Button variant="outline" className="h-11 rounded-full" disabled={at >= groups.length - 1} onClick={() => onIndex(at + 1)}>
                次の組 <ChevronRightIcon />
              </Button>
            </div>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {importable === 0 && <p className="text-sm text-muted-foreground">取り込める行がありません。</p>}
      {!allDecided && <p className="text-sm text-muted-foreground">すべての組を選ぶと取り込めます。</p>}
      <div className="flex justify-between gap-2">
        <Button variant="outline" className="h-11 rounded-full md:h-10" onClick={onBack}>
          戻る
        </Button>
        <Button className="h-11 rounded-full md:h-10" disabled={!allDecided || importable === 0 || pending} onClick={onCommit}>
          取り込む
        </Button>
      </div>
    </div>
  );
}

/**
 * 数の行。
 * @param props - label：名前、value：数
 * @returns 行
 */
function CountRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </li>
  );
}

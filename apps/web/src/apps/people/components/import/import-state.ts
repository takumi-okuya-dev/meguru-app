// 取り込みの確かめの段の決め（specs/people/001-people-memo contracts/api.md 3、contracts/ui-routes.md 2）。
// 候補の行（candidate）と、同じCSVの中の重なり（duplicate_in_file）の行に、行ごとの決めが要る。new の行は決めを省いてよい。
import type { ImportField, ImportInvalidReason, ImportPreview, ImportPreviewRow } from "@meguru/shared/people";
import type { ImportDecision } from "../../lib/api";

/** 行ごとの決め（行の番号 → 決め）。 */
export type DecisionMap = ReadonlyMap<number, Omit<ImportDecision, "row">>;

/** 決める組：候補の行1つ、または同じCSVの中で同じLINE名の行の組。 */
export type DecisionGroup =
  | { kind: "candidate"; key: string; row: ImportPreviewRow }
  | { kind: "duplicate"; key: string; groupId: number; rows: ImportPreviewRow[] };

/**
 * 決める組を、行の順に並べる。
 * @param preview - プレビュー
 * @returns 決める組
 */
export function decisionGroups(preview: ImportPreview): DecisionGroup[] {
  const groups: DecisionGroup[] = [];
  const dup = new Map<number, ImportPreviewRow[]>();
  for (const r of preview.rows) {
    if (r.status === "candidate") groups.push({ kind: "candidate", key: `row-${r.row}`, row: r });
    if (r.status === "duplicate_in_file" && r.groupId !== undefined) {
      const rows = dup.get(r.groupId);
      if (rows) rows.push(r);
      else {
        const list = [r];
        dup.set(r.groupId, list);
        groups.push({ kind: "duplicate", key: `group-${r.groupId}`, groupId: r.groupId, rows: list });
      }
    }
  }
  return groups;
}

/**
 * 組の行の番号。
 * @param g - 組
 * @returns 行の番号
 */
export function groupRows(g: DecisionGroup): number[] {
  return g.kind === "candidate" ? [g.row.row] : g.rows.map((r) => r.row);
}

/**
 * 組を決めたか（組のすべての行に決めがあるか）。
 * @param g - 組
 * @param decisions - 行ごとの決め
 * @returns 決めたなら true
 */
export function groupDecided(g: DecisionGroup, decisions: DecisionMap): boolean {
  return groupRows(g).every((row) => decisions.has(row));
}

/**
 * 前のプレビューで決めたことのうち、新しいプレビューでもそのまま使えるものだけを残す（409 のあとで読み直したとき）。
 * 行の状態・組が変わった行や、つなぐ先が候補からいなくなった行の決めは捨てる。重なりの組は、1行でも捨てたら組ごと捨てる。
 * @param prev - 前のプレビュー（なければ何も残さない）
 * @param next - 新しいプレビュー
 * @param decisions - 行ごとの決め
 * @returns 残した決め
 */
export function keepValidDecisions(prev: ImportPreview | null, next: ImportPreview, decisions: DecisionMap): Map<number, Omit<ImportDecision, "row">> {
  const kept = new Map<number, Omit<ImportDecision, "row">>();
  if (!prev) return kept;
  const before = new Map(prev.rows.map((r) => [r.row, r]));
  for (const r of next.rows) {
    const d = decisions.get(r.row);
    const old = before.get(r.row);
    if (!d || !old || old.status !== r.status || old.groupId !== r.groupId) continue;
    if (r.status !== "candidate" && r.status !== "duplicate_in_file") continue;
    if (d.action === "link" && !(r.candidates ?? []).some((c) => c.personId === d.personId)) continue;
    kept.set(r.row, d);
  }
  for (const g of decisionGroups(next)) {
    if (g.kind === "duplicate" && !groupDecided(g, kept)) for (const row of groupRows(g)) kept.delete(row);
  }
  return kept;
}

/**
 * 送る決めの一覧にする（行の順）。
 * @param decisions - 行ごとの決め
 * @returns 決めの一覧
 */
export function toDecisionList(decisions: DecisionMap): ImportDecision[] {
  return [...decisions.entries()].sort(([a], [b]) => a - b).map(([row, d]) => ({ row, ...d }));
}

/** 取り込めない理由の名前。 */
export const INVALID_REASON_LABELS: Record<ImportInvalidReason, string> = {
  line_name_empty: "LINE名が空",
  line_name_too_long: "LINE名が長すぎる",
  real_name_too_long: "本名が長すぎる",
};

/** 確かめの段に出す数（FR-006）。 */
export type ConfirmCounts = {
  newCount: number;
  candidateCount: number;
  duplicateGroupCount: number;
  invalid: { reason: ImportInvalidReason; count: number }[];
  alreadyImported: number;
  erased: number;
};

/**
 * 確かめの段に出す数を数える。
 * @param preview - プレビュー
 * @returns 数
 */
export function confirmCounts(preview: ImportPreview): ConfirmCounts {
  const count = (s: ImportPreviewRow["status"]) => preview.rows.filter((r) => r.status === s).length;
  const reasons = Object.keys(INVALID_REASON_LABELS) as ImportInvalidReason[];
  return {
    newCount: preview.summary.newCount,
    candidateCount: preview.summary.candidateCount,
    duplicateGroupCount: new Set(preview.rows.filter((r) => r.status === "duplicate_in_file").map((r) => r.groupId)).size,
    invalid: reasons
      .map((reason) => ({ reason, count: preview.rows.filter((r) => r.status === "invalid" && r.invalidReason === reason).length }))
      .filter((x) => x.count > 0),
    alreadyImported: count("already_imported"),
    erased: count("erased"),
  };
}

/** 列の対応の誤り（画面で確かめる分）。 */
export type MappingProblem = "line_name_missing" | "duplicate_field" | "unselected";

/**
 * 列の対応を確かめる（LINE名の列がない・同じ項目に2列・選んでいない列）。「そのほか」は何列でもよい。
 * @param columns - 列ごとの項目
 * @returns 誤りと、2列以上に選ばれた項目
 */
export function mappingProblems(columns: readonly (ImportField | null)[]): { problems: MappingProblem[]; duplicated: ImportField[] } {
  const problems: MappingProblem[] = [];
  if (!columns.includes("line_name")) problems.push("line_name_missing");
  const seen = new Set<ImportField>();
  const duplicated = new Set<ImportField>();
  for (const c of columns) {
    if (c === null || c === "other") continue;
    if (seen.has(c)) duplicated.add(c);
    seen.add(c);
  }
  if (duplicated.size > 0) problems.push("duplicate_field");
  if (columns.some((c) => c === null)) problems.push("unselected");
  return { problems, duplicated: [...duplicated] };
}

// 下書きのラベルの行と本文の強調（specs/004-review-approval FR-016・FR-027・FR-039、contracts/ui-routes.md「下書きのカード」）。
// 本文は文字として描き、当たった範囲だけを <mark> で囲む（dangerouslySetInnerHTML は使わない）。
import type { PublishCheck } from "@threads-grower/shared";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 強調の種類。NGワードは destructive 系、規約に注意は warning 系の背景。 */
export type HighlightKind = "ng" | "policy";
type Mark = { start: number; end: number; kind: HighlightKind };

/**
 * 判定の結果から、本文の強調の範囲を作る。
 * @param check - 承認できるかの判定
 * @returns 強調の範囲（元の本文の位置）
 */
export function highlightsOf(check: PublishCheck): Mark[] {
  return [
    ...check.ngWords.flatMap((h) => h.ranges.map(([start, end]) => ({ start, end, kind: "ng" as const }))),
    ...check.policyCautions.flatMap((h) => h.ranges.map(([start, end]) => ({ start, end, kind: "policy" as const }))),
  ];
}

/**
 * 本文を、当たった範囲を強調して描く。範囲が重なるときは NGワードを優先する。
 * @param props - body：本文、marks：強調の範囲
 * @returns 本文
 */
export function HighlightedBody({ body, marks }: { body: string; marks: Mark[] }) {
  if (marks.length === 0) return <>{body}</>;
  // 1文字ずつ種類を決めてから、同じ種類の連続をまとめる（重なり・隣り合いを扱いやすくする）
  const kinds: (HighlightKind | null)[] = Array.from({ length: body.length }, () => null);
  for (const m of [...marks].sort((a, b) => (a.kind === "ng" ? 1 : 0) - (b.kind === "ng" ? 1 : 0))) {
    for (let i = m.start; i < m.end && i < body.length; i++) kinds[i] = m.kind;
  }
  const parts: ReactNode[] = [];
  let from = 0;
  for (let i = 1; i <= body.length; i++) {
    if (i < body.length && kinds[i] === kinds[from]) continue;
    const text = body.slice(from, i);
    const kind = kinds[from];
    parts.push(
      kind ? (
        <mark
          key={from}
          className={cn(
            "rounded-sm px-0.5 text-foreground",
            kind === "ng" ? "bg-destructive/20 underline decoration-destructive" : "bg-warning-bg underline decoration-warning",
          )}
        >
          {text}
        </mark>
      ) : (
        text
      ),
    );
    from = i;
  }
  return <>{parts}</>;
}

/**
 * NGワードのラベル（「NGワード：絶対、必ず儲かる」）。
 * @param props - check：承認できるかの判定
 * @returns ラベル（当たりがなければ何も出さない）
 */
export function NgWordLabel({ check }: { check: PublishCheck }) {
  if (check.ngWords.length === 0) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-destructive/40 px-2.5 py-0.5 text-[13px] text-destructive">
      NGワード：{check.ngWords.map((h) => h.word).join("、")}
    </span>
  );
}

/**
 * ラベルの行。ラベルが1つもなければ何も出さない。
 * @param props - labels：出すラベル（当てはまるものだけ）
 * @returns ラベルの行
 */
export function LabelRow({ labels }: { labels: ReactNode[] }) {
  if (labels.length === 0) return null;
  return <div className="flex flex-wrap items-start gap-1.5">{labels}</div>;
}

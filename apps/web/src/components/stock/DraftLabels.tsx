// 下書きのラベルの行と本文の強調（specs/004-review-approval FR-016・FR-027・FR-039、contracts/ui-routes.md「下書きのカード」）。
// 本文は文字として描き、当たった範囲だけを <mark> で囲む（dangerouslySetInnerHTML は使わない）。
import {
  SIMILARITY_THRESHOLD,
  type PostDraft,
  type PostDraftStatus,
  type PublishCheck,
  type SimilarityResult,
} from "@threads-grower/shared";
import { useId, useState, type ReactNode } from "react";
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
    ...check.ngWords.flatMap((h) =>
      h.ranges.map(([start, end]) => ({ start, end, kind: "ng" as const })),
    ),
    ...check.policyCautions.flatMap((h) =>
      h.ranges.map(([start, end]) => ({ start, end, kind: "policy" as const })),
    ),
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
  for (const m of [...marks].sort(
    (a, b) => (a.kind === "ng" ? 1 : 0) - (b.kind === "ng" ? 1 : 0),
  )) {
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
            kind === "ng"
              ? "bg-destructive/20 underline decoration-destructive"
              : "bg-warning-bg underline decoration-warning",
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

const STATUS_LABEL: Record<PostDraftStatus, string> = {
  needs_review: "要確認",
  approved: "承認済み",
  rejected: "却下",
  publishing: "投稿の処理中",
  published: "投稿済み",
  publish_failed: "投稿に失敗",
};

/**
 * 類似度のラベルと、押すと開く「似ている投稿」（FR-026〜FR-028）。
 * 80%以上は注意の色にして「似ている投稿があります」を添える（色だけで区別しない）。
 * @param props - result：類似度の結果（計算中は null、比べない短い本文は undefined）、
 *   find：IDから下書きを引く、onJump：似ている相手の下書きへ移る
 * @returns ラベル（比べない本文では何も出さない）
 */
export function SimilarityLabel({
  result,
  find,
  onJump,
}: {
  result: SimilarityResult | null | undefined;
  find: (id: string) => PostDraft | undefined;
  onJump: (draft: PostDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (result === undefined) return null;
  if (result === null) {
    return (
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[13px] text-muted-foreground">
        類似度 計算中
      </span>
    );
  }
  const high = result.score >= SIMILARITY_THRESHOLD;
  const matches = result.matches.map((m) => ({ ...m, draft: find(m.id) })).filter((m) => m.draft);
  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={matches.length === 0}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px]",
          high ? "bg-warning-bg text-warning" : "bg-muted text-muted-foreground",
          matches.length > 0 && "hover:underline",
        )}
      >
        類似度 {result.score}%{high && "・似ている投稿があります"}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="似ている投稿"
          className="space-y-1.5 rounded-xl border bg-background p-3"
        >
          <p className="text-xs font-medium text-muted-foreground">似ている投稿</p>
          <ul className="space-y-1.5">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onJump(m.draft!)}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                >
                  <span className="mr-2 tabular-nums">{m.score}%</span>
                  <span className="mr-2 rounded-full bg-muted px-2 py-px text-[11px]">
                    {STATUS_LABEL[m.draft!.status]}
                  </span>
                  <span className="line-clamp-3 whitespace-pre-wrap">{m.draft!.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * 規約に注意のラベルと、押すと開く説明（FR-039）。承認済みのタブでは、要確認に戻すことを勧める（spec エッジケース）。
 * 文言は「注意」「おそれ」にとどめる（FR-043）。
 * @param props - check：承認できるかの判定、onReopen：承認済みの下書きを要確認に戻す（承認済みのタブだけ渡す）
 * @returns ラベル（当たりがなければ何も出さない）
 */
export function PolicyCautionLabels({
  check,
  onReopen,
}: {
  check: PublishCheck;
  onReopen?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const panelId = useId();
  if (check.policyCautions.length === 0) return null;
  const current = check.policyCautions.find((c) => c.id === open);
  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {check.policyCautions.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-expanded={open === c.id}
            aria-controls={panelId}
            onClick={() => setOpen((v) => (v === c.id ? null : c.id))}
            className="inline-flex min-h-8 items-center rounded-full bg-warning-bg px-2.5 py-0.5 text-[13px] text-warning hover:underline"
          >
            規約に注意：{c.label}
          </button>
        ))}
      </div>
      {current && (
        <div
          id={panelId}
          role="region"
          aria-label="規約に注意の説明"
          className="space-y-1 rounded-xl border bg-background p-3 text-[13px]"
        >
          <p>
            Threadsの規約（{current.policyName}）に触れるおそれのある表現です。{current.suggestion}
          </p>
          <a
            href={current.policyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-ring underline"
          >
            {current.policyName}を開く
          </a>
        </div>
      )}
      {onReopen && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>規約に注意の表現があります。要確認に戻して確かめることをおすすめします</span>
          <button type="button" className="text-ring underline" onClick={onReopen}>
            要確認に戻す
          </button>
        </div>
      )}
    </div>
  );
}

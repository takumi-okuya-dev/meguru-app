// パフォーマンス分析の計算（specs/006-performance-feedback research.md R4・R5）。APIとWebで同じ結果にするため共通に置く。
import {
  METRICS_LATE_AFTER_HOURS,
  METRICS_MILESTONE_HOURS,
  METRICS_WINDOW_MINUTES,
  PERFORMANCE_GOOD_RATIO,
  PERFORMANCE_POOR_RATIO,
} from "./limits";

/** 取り込む時点（24時間・3日・7日）。 */
export type MetricsMilestone = keyof typeof METRICS_MILESTONE_HOURS;
/** 取り込みの種類（時点と、遅れて確定）。 */
export type MetricsKindValue = MetricsMilestone | "late";
/** 判定。 */
export type JudgmentValue = "good" | "normal" | "poor";

const MILESTONES: MetricsMilestone[] = ["h24", "d3", "d7"];
const DAY_MS = 86_400_000;

/**
 * 投稿からの経過（分。切り捨て）。
 * @param publishedAt - 投稿した日時
 * @param now - 今
 * @returns 経過した分
 */
export function elapsedMinutes(publishedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - publishedAt.getTime()) / 60_000);
}

/**
 * 時点の取り込みの幅（その時点の±1時間）に入っていれば、その時点を返す（FR-002d）。
 * @param minutes - 投稿からの経過（分）
 * @returns 時点。幅の外なら null
 */
export function milestoneForElapsed(minutes: number): MetricsMilestone | null {
  for (const m of MILESTONES) {
    const center = METRICS_MILESTONE_HOURS[m] * 60;
    if (minutes >= center - METRICS_WINDOW_MINUTES && minutes <= center + METRICS_WINDOW_MINUTES) return m;
  }
  return null;
}

/**
 * 補い（毎日の処理）で取る種類（FR-002、research.md R4）。過ぎた時点（幅の終わりを過ぎた）のうち最も新しい1つ。
 * その時点か、それより後の時点を取っていれば補わない。7日を補うとき、経過が192時間を過ぎていれば「遅れて確定」。
 * @param minutes - 投稿からの経過（分）
 * @param taken - 取った時点
 * @returns 取る種類。補わないなら null
 */
export function catchUpKind(minutes: number, taken: ReadonlySet<MetricsMilestone>): MetricsKindValue | null {
  let latest: number = -1;
  MILESTONES.forEach((m, i) => {
    if (minutes > METRICS_MILESTONE_HOURS[m] * 60 + METRICS_WINDOW_MINUTES) latest = i;
  });
  if (latest < 0) return null;
  if (MILESTONES.slice(latest).some((m) => taken.has(m))) return null;
  const kind = MILESTONES[latest]!;
  if (kind === "d7" && minutes > METRICS_LATE_AFTER_HOURS * 60) return "late";
  return kind;
}

/**
 * 閲覧数を基準値と比べて判定する（FR-008）。丸める前の値で比べる。
 * @param views - 閲覧数
 * @param baseline - 基準値（0より大きいこと）
 * @returns 判定
 */
export function judge(views: number, baseline: number): JudgmentValue {
  const ratio = views / baseline;
  if (ratio >= PERFORMANCE_GOOD_RATIO) return "good";
  if (ratio <= PERFORMANCE_POOR_RATIO) return "poor";
  return "normal";
}

/**
 * 中央値。偶数個は真ん中2つの平均。
 * @param values - 値
 * @returns 中央値。空なら null
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 表示する倍率（小数第1位）。
 * @param ratio - 倍率（丸める前）
 * @returns 「3.4」などの文字列
 */
export function formatRatio(ratio: number): string {
  return ratio.toFixed(1);
}

/**
 * 確定して判定する日の目安（投稿から7日後。FR-017）。
 * @param publishedAt - 投稿した日時
 * @returns 目安の日時
 */
export function confirmAtOf(publishedAt: Date): Date {
  return new Date(publishedAt.getTime() + 7 * DAY_MS);
}

/**
 * 最初に取り込む時刻の目安（投稿から24時間後。FR-017）。
 * @param publishedAt - 投稿した日時
 * @returns 目安の日時
 */
export function nextFetchAtOf(publishedAt: Date): Date {
  return new Date(publishedAt.getTime() + DAY_MS);
}

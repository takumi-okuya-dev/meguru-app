// 区切りの集計・傾向・おすすめに乗った目安（specs/022-algorithm-analysis research.md R4〜R6・R11）。
// 決まった計算だけで、アプリの中でAIを呼ばない（原則III）。中央値で比べる（FR-010）。
import {
  ANALYSIS_MAX_TRENDS,
  ANALYSIS_MIN_BUCKET,
  ANALYSIS_MIN_TOTAL,
  ANALYSIS_RECOMMENDED_TOP,
  ANALYSIS_TREND_RATIO,
} from "../limits";
import { median } from "../performance";
import type { PostLengthSettings } from "../schemas";
import {
  DAY_KINDS,
  OPENING_TYPE_LABELS,
  OPENING_TYPES,
  TEXT_FEATURES,
  TIME_BUCKETS,
  type AnalysisPost,
  type AnalysisResult,
  type AnalysisTheme,
  type BucketMark,
  type BucketRow,
  type CompareValues,
  type FeatureRow,
  type PostValues,
  type RecommendedPost,
  type Trend,
  type TrendDimension,
} from "./types";
import { lengthBuckets, postValues } from "./values";

/** 解析の設定。 */
export type AnalyzeOptions = { lengthSettings: PostLengthSettings; themes: readonly AnalysisTheme[] };

type Item = { p: AnalysisPost; v: PostValues };

const HEAD_LENGTH = 40;

const medianOf = (items: readonly Item[], pick: (i: Item) => number | null) =>
  median(items.map(pick).filter((x): x is number => x !== null));

const markOf = (count: number): BucketMark => (count === 0 ? "untried" : count < ANALYSIS_MIN_BUCKET ? "few" : null);

/**
 * 区切り1つの集計。
 * @param key - 区切りの key
 * @param label - 名前
 * @param items - その区切りの投稿
 * @returns 件数と中央値
 */
function bucketRow(key: string, label: string, items: readonly Item[]): BucketRow {
  return {
    key,
    label,
    count: items.length,
    views: medianOf(items, (i) => i.p.views),
    engagementRate: medianOf(items, (i) => i.v.engagementRate),
    replyRate: medianOf(items, (i) => i.v.replyRate),
    mark: markOf(items.length),
  };
}

type Candidate = Omit<Trend, "ratio" | "promptable"> & { ratio: number };

/**
 * 区切りの投稿と、ほかの投稿を比べる（research.md R5 の3つの決まり）。
 * @param group - 区切りの投稿
 * @param others - ほかの投稿
 * @param base - 傾向の区切り・key・文
 * @returns 傾向にできれば候補、できなければ null
 */
function compareGroups(group: readonly Item[], others: readonly Item[], base: Pick<Trend, "dimension" | "key" | "text">): Candidate | null {
  if (group.length < ANALYSIS_MIN_BUCKET || others.length < ANALYSIS_MIN_BUCKET) return null;
  const views = medianOf(group, (i) => i.p.views)!;
  const otherViews = medianOf(others, (i) => i.p.views)!;
  if (otherViews <= 0 || views / otherViews < ANALYSIS_TREND_RATIO) return null;
  return { ...base, count: group.length, views, otherCount: others.length, otherViews, ratio: views / otherViews };
}

const PROMPTABLE: Record<TrendDimension, boolean> = {
  time: false,
  day: false,
  length: true,
  feature: true,
  opening: true,
  theme: true,
};

/**
 * 傾向を選ぶ。区切りの種類ごと（本文の特徴は特徴ごと）に倍率の最も大きい1つを残し、倍率の大きい順に5つまで。
 * @param candidates - 候補
 * @returns 傾向
 */
function pickTrends(candidates: readonly Candidate[]): Trend[] {
  const best = new Map<string, Candidate>();
  for (const c of candidates) {
    const kind = c.dimension === "feature" ? `feature:${c.key.split(":")[0]}` : c.dimension;
    const cur = best.get(kind);
    if (!cur || c.ratio > cur.ratio) best.set(kind, c);
  }
  return [...best.values()]
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, ANALYSIS_MAX_TRENDS)
    .map((c) => ({ ...c, key: c.dimension === "feature" ? c.key.split(":")[0]! : c.key, promptable: PROMPTABLE[c.dimension] }));
}

/**
 * 比べの値（FR-021）。
 * @param items - 投稿
 * @returns 中央値と件数
 */
function compareValues(items: readonly Item[]): CompareValues {
  return {
    count: items.length,
    firstSpeed: medianOf(items, (i) => i.v.firstSpeed),
    laterGrowth: medianOf(items, (i) => i.v.laterGrowth),
    replyRate: medianOf(items, (i) => i.v.replyRate),
    length: medianOf(items, (i) => i.v.length),
    questionCount: items.filter((i) => i.v.features.question).length,
  };
}

/**
 * おすすめに乗った目安（research.md R6）。広がりの上位20%で、広がりが1を超える投稿。
 * @param items - 投稿
 * @returns 出せるか・投稿・比べ
 */
function recommendedOf(items: readonly Item[]): AnalysisResult["recommended"] {
  const withSpread = items.filter((i) => i.v.spread !== null);
  if (withSpread.length < ANALYSIS_MIN_BUCKET) return { available: false, posts: [], compare: null };
  const sorted = withSpread.map((i) => i.v.spread!).sort((a, b) => a - b);
  const threshold = sorted[Math.floor((1 - ANALYSIS_RECOMMENDED_TOP) * sorted.length)]!;
  const rec = withSpread.filter((i) => i.v.spread! >= threshold && i.v.spread! > 1);
  const others = withSpread.filter((i) => !rec.includes(i));
  const posts: RecommendedPost[] = [...rec]
    .sort((a, b) => b.v.spread! - a.v.spread! || b.p.views - a.p.views)
    .map(({ p, v }) => ({
      id: p.id,
      head: [...p.body.replace(/\s*\n\s*/g, " ").trim()].slice(0, HEAD_LENGTH).join(""),
      publishedAt: p.publishedAt,
      views: p.views,
      spread: v.spread!,
      firstSpeed: v.firstSpeed,
      laterGrowth: v.laterGrowth,
      replyRate: v.replyRate,
    }));
  return { available: true, posts, compare: rec.length > 0 ? { recommended: compareValues(rec), others: compareValues(others) } : null };
}

/**
 * 解析する（contracts/analysis.md）。
 * @param posts - 確定した投稿（選んだ範囲）
 * @param opts - 文字数の設定とテーマ
 * @returns 解析の結果
 */
export function analyzePosts(posts: readonly AnalysisPost[], opts: AnalyzeOptions): AnalysisResult {
  const items: Item[] = posts.map((p) => ({ p, v: postValues(p, opts.lengthSettings) }));
  const themeIds = new Set(opts.themes.map((t) => t.id));
  const classified = items.filter((i) => i.p.openingType !== null);
  const totals = {
    confirmed: items.length,
    promo: items.filter((i) => i.p.promo).length,
    withFollowers: items.filter((i) => i.v.spread !== null).length,
    classified: classified.length,
  };
  if (items.length < ANALYSIS_MIN_TOTAL) {
    return {
      totals,
      needMore: ANALYSIS_MIN_TOTAL - items.length,
      trends: [],
      time: [],
      day: [],
      length: [],
      features: [],
      opening: [],
      theme: [],
      recommended: { available: false, posts: [], compare: null },
    };
  }

  const candidates: Candidate[] = [];
  /**
   * 区切りの表を作り、区切りごとに傾向の候補を足す。
   * @param dimension - 区切りの種類
   * @param universe - 比べる投稿の全体
   * @param defs - 区切り（key・名前・入るか・傾向の文）
   * @returns 表
   */
  const table = (
    dimension: TrendDimension,
    universe: readonly Item[],
    defs: { key: string; label: string; test: (i: Item) => boolean; text: string }[],
  ): BucketRow[] =>
    defs.map((d) => {
      const group = universe.filter(d.test);
      const c = compareGroups(group, universe.filter((i) => !d.test(i)), { dimension, key: d.key, text: d.text });
      if (c) candidates.push(c);
      return bucketRow(d.key, d.label, group);
    });

  const time = table(
    "time",
    items,
    TIME_BUCKETS.map((b) => ({ key: b.key, label: b.label, test: (i) => i.v.timeBucket === b.key, text: `${b.label}に出した投稿が伸びやすい` })),
  );
  const day = table(
    "day",
    items,
    DAY_KINDS.map((d) => ({ key: d.key, label: d.label, test: (i) => i.v.dayKind === d.key, text: `${d.label}に出した投稿が伸びやすい` })),
  );
  const length = table(
    "length",
    items,
    lengthBuckets(opts.lengthSettings).map((b) => ({ key: b.key, label: b.label, test: (i) => i.v.lengthBucket === b.key, text: `${b.label}の投稿が伸びやすい` })),
  );
  const features: FeatureRow[] = TEXT_FEATURES.map((f) => {
    const withItems = items.filter((i) => i.v.features[f.key]);
    const withoutItems = items.filter((i) => !i.v.features[f.key]);
    for (const [g, o, side, text] of [
      [withItems, withoutItems, "with", f.withText],
      [withoutItems, withItems, "without", f.withoutText],
    ] as const) {
      const c = compareGroups(g, o, { dimension: "feature", key: `${f.key}:${side}`, text: `${text}投稿が伸びやすい` });
      if (c) candidates.push(c);
    }
    const w = medianOf(withItems, (i) => i.p.views);
    const wo = medianOf(withoutItems, (i) => i.p.views);
    const enough = withItems.length >= ANALYSIS_MIN_BUCKET && withoutItems.length >= ANALYSIS_MIN_BUCKET;
    return {
      key: f.key,
      label: f.label,
      with: { count: withItems.length, views: w },
      without: { count: withoutItems.length, views: wo },
      ratio: enough && wo !== null && wo > 0 && w !== null ? w / wo : null,
      mark: markOf(Math.min(withItems.length, withoutItems.length)),
    };
  });
  const opening = table(
    "opening",
    classified,
    OPENING_TYPES.map((t) => ({
      key: t,
      label: OPENING_TYPE_LABELS[t],
      test: (i) => i.p.openingType === t,
      text: `「${OPENING_TYPE_LABELS[t]}」の書き出しが伸びやすい`,
    })),
  );
  const theme = table(
    "theme",
    classified,
    opts.themes.map((t) => ({
      key: t.id,
      label: t.name,
      test: (i) => i.p.themeId !== null && themeIds.has(i.p.themeId) && i.p.themeId === t.id,
      text: `テーマ「${t.name}」の投稿が伸びやすい`,
    })),
  );

  return {
    totals,
    needMore: null,
    trends: pickTrends(candidates),
    time,
    day,
    length,
    features,
    opening,
    theme,
    recommended: recommendedOf(items),
  };
}

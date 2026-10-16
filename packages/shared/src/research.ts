// リサーチの参考投稿・キーワードの手助け（specs/014-strategy-guidance research.md R6〜R8・R16）。
// 鮮度・プロンプトの並び・解説のプロンプトと取り出し・キーワードの案の取り出しを、APIとWebで共有する。

/** 参考投稿の媒体（data-model.md の reference_posts.platform）。 */
export const REFERENCE_PLATFORMS = [
  { value: "threads", label: "Threads" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "x", label: "X" },
  { value: "other", label: "その他" },
] as const;

/** 参考投稿の媒体の値。 */
export type ReferencePlatform = (typeof REFERENCE_PLATFORMS)[number]["value"];

/** 媒体の値の一覧（zod の enum 用）。 */
export const REFERENCE_PLATFORM_VALUES = REFERENCE_PLATFORMS.map((p) => p.value) as unknown as readonly [
  ReferencePlatform,
  ...ReferencePlatform[],
];

/** 元の投稿の投稿日の選び方（data-model.md の reference_posts.posted_date_mode）。 */
export const POSTED_DATE_MODES = [
  { value: "exact", label: "日付を入力する" },
  { value: "week", label: "1週間以内" },
  { value: "month", label: "1か月以内" },
  { value: "3months", label: "3か月以内" },
  { value: "unknown", label: "不明" },
] as const;

/** 投稿日の選び方の値。 */
export type PostedDateMode = (typeof POSTED_DATE_MODES)[number]["value"];

/** 投稿日の選び方の値の一覧（zod の enum 用）。 */
export const POSTED_DATE_MODE_VALUES = POSTED_DATE_MODES.map((m) => m.value) as unknown as readonly [
  PostedDateMode,
  ...PostedDateMode[],
];

/** 鮮度（research.md R6）。保存せず、そのつど求める。 */
export const FRESHNESS_LEVELS = [
  { value: "latest", label: "最新" },
  { value: "active", label: "現役" },
  { value: "unknown", label: "投稿日不明" },
  { value: "archive", label: "アーカイブ" },
] as const;

/** 鮮度の値。並びは、投稿のプロンプトに入る順（FR-099）。 */
export type Freshness = (typeof FRESHNESS_LEVELS)[number]["value"];

/** 鮮度の値の一覧（zod の enum 用）。 */
export const FRESHNESS_VALUES = FRESHNESS_LEVELS.map((f) => f.value) as unknown as readonly [Freshness, ...Freshness[]];

/** 参考投稿の反応の数字のキー（data-model.md の metric_*）。 */
export const REFERENCE_METRIC_KEYS = ["likes", "replies", "views", "saves", "reposts", "followers"] as const;

/** 参考投稿の反応の数字のキー。 */
export type ReferenceMetricKey = (typeof REFERENCE_METRIC_KEYS)[number];

/** 反応の数字（わからなければ null）。 */
export type ReferenceMetrics = Record<ReferenceMetricKey, number | null>;

// アルゴリズムの解析の型と区切り（specs/022-algorithm-analysis data-model.md「共有の型」、research.md R3・R4）。

/** 書き出しの型（固定の7つ。FR-050）。 */
export const OPENING_TYPES = ["aruaru", "question", "assertion", "story", "number", "announce", "other"] as const;
/** 書き出しの型。 */
export type OpeningType = (typeof OPENING_TYPES)[number];
/** 書き出しの型の名前。 */
export const OPENING_TYPE_LABELS: Record<OpeningType, string> = {
  aruaru: "あるある",
  question: "問いかけ",
  assertion: "言い切り",
  story: "体験談",
  number: "数字",
  announce: "告知",
  other: "その他",
};

/** 時間帯（日本時間。FR-002）。`from`〜`to` は時（両端を含む）。 */
export const TIME_BUCKETS = [
  { key: "morning", label: "朝（5〜10時）", short: "朝", from: 5, to: 10 },
  { key: "noon", label: "昼（11〜15時）", short: "昼", from: 11, to: 15 },
  { key: "evening", label: "夕方（16〜19時）", short: "夕方", from: 16, to: 19 },
  { key: "night", label: "夜（20〜23時）", short: "夜", from: 20, to: 23 },
  { key: "latenight", label: "深夜（0〜4時）", short: "深夜", from: 0, to: 4 },
] as const;
/** 時間帯。 */
export type TimeBucket = (typeof TIME_BUCKETS)[number]["key"];

/** 平日・休日。 */
export const DAY_KINDS = [
  { key: "weekday", label: "平日" },
  { key: "holiday", label: "休日" },
] as const;
/** 平日・休日。 */
export type DayKind = (typeof DAY_KINDS)[number]["key"];

/** 文字数の区切り。 */
export type LengthBucket = "short" | "medium" | "long";

/** 本文の特徴（research.md R4）。`withText`・`withoutText` は傾向の文に使う。 */
export const TEXT_FEATURES = [
  { key: "question", label: "最後に問いかけ", withText: "最後に問いかけがある", withoutText: "最後に問いかけのない" },
  { key: "number", label: "数字を入れる", withText: "数字を入れた", withoutText: "数字のない" },
  { key: "shortFirstLine", label: "1行目が20字以内", withText: "1行目が20字以内の", withoutText: "1行目が20字を超える" },
  { key: "manyLines", label: "改行が多い（5行以上）", withText: "改行が多い（5行以上）", withoutText: "改行が少ない（4行まで）" },
  { key: "emoji", label: "絵文字", withText: "絵文字を入れた", withoutText: "絵文字のない" },
  { key: "callout", label: "呼びかけ", withText: "呼びかけ（あなた・みんな）がある", withoutText: "呼びかけのない" },
] as const;
/** 本文の特徴。 */
export type TextFeature = (typeof TEXT_FEATURES)[number]["key"];

/** テーマ（Accountごと。FR-050）。 */
export type AnalysisTheme = { id: string; name: string };

/** 計算の入力（確定した投稿1件）。 */
export type AnalysisPost = {
  id: string;
  body: string;
  /** 投稿した日時（ISO 8601） */
  publishedAt: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  /** 投稿した時点のフォロワー数（記録がなければ null） */
  followersAtPost: number | null;
  /** 24時間時点の閲覧数（取り込みがなければ null） */
  h24Views: number | null;
  openingType: OpeningType | null;
  themeId: string | null;
  /** 宣伝の投稿か（research.md R9） */
  promo: boolean;
};

/** 投稿ごとに求めた値（research.md R3・R4）。 */
export type PostValues = {
  timeBucket: TimeBucket;
  dayKind: DayKind;
  lengthBucket: LengthBucket;
  length: number;
  features: Record<TextFeature, boolean>;
  engagementRate: number | null;
  replyRate: number | null;
  spread: number | null;
  firstSpeed: number | null;
  laterGrowth: number | null;
};

/** 区切りの印。`few`＝件数が少ない、`untried`＝試していない。 */
export type BucketMark = "few" | "untried" | null;

/** 区切りの集計（中央値。件数が0なら値は null）。 */
export type BucketRow = {
  key: string;
  label: string;
  count: number;
  views: number | null;
  engagementRate: number | null;
  replyRate: number | null;
  mark: BucketMark;
};

/** 本文の特徴の集計。 */
export type FeatureRow = {
  key: TextFeature;
  label: string;
  with: { count: number; views: number | null };
  without: { count: number; views: number | null };
  /** あり ÷ なし の閲覧の中央値。どちらかが10件未満・なしが0なら null */
  ratio: number | null;
  mark: BucketMark;
};

/** 区切りの種類。 */
export type TrendDimension = "time" | "day" | "length" | "feature" | "opening" | "theme";

/** 傾向（research.md R5）。 */
export type Trend = {
  dimension: TrendDimension;
  key: string;
  text: string;
  count: number;
  views: number;
  otherCount: number;
  otherViews: number;
  ratio: number;
  /** 本文で変えられる傾向（プロンプトに入れられる。research.md R7） */
  promptable: boolean;
};

/** おすすめに乗った目安の投稿。 */
export type RecommendedPost = {
  id: string;
  /** 本文の初めの40文字 */
  head: string;
  publishedAt: string;
  views: number;
  spread: number;
  firstSpeed: number | null;
  laterGrowth: number | null;
  replyRate: number | null;
};

/** おすすめに乗った目安と、ほかの投稿の比べ（中央値。FR-021）。 */
export type CompareValues = {
  count: number;
  firstSpeed: number | null;
  laterGrowth: number | null;
  replyRate: number | null;
  length: number | null;
  questionCount: number;
};

/** 解析の結果。 */
export type AnalysisResult = {
  totals: { confirmed: number; promo: number; withFollowers: number; classified: number };
  needMore: number | null;
  trends: Trend[];
  time: BucketRow[];
  day: BucketRow[];
  length: BucketRow[];
  features: FeatureRow[];
  opening: BucketRow[];
  theme: BucketRow[];
  recommended: {
    available: boolean;
    posts: RecommendedPost[];
    compare: { recommended: CompareValues; others: CompareValues } | null;
  };
};

// リサーチの参考投稿・キーワードの手助け（specs/014-strategy-guidance research.md R6〜R8・R16）。
// 鮮度・プロンプトの並び・解説のプロンプトと取り出し・キーワードの案の取り出しを、APIとWebで共有する。
import { FRESHNESS_ACTIVE_DAYS, FRESHNESS_LATEST_DAYS } from "./limits";
import { addDays, jstDateOf } from "./schedule";

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

/** 投稿日の選び方ごとの、登録日からさかのぼる日数（日付を入れなかったときのみなしの投稿日。FR-096）。 */
const MODE_DAYS: Partial<Record<PostedDateMode, number>> = { week: 7, month: 30, "3months": 90 };

/** 鮮度を求めるのに要る参考投稿の値。 */
export type FreshnessSource = {
  postedDateMode: PostedDateMode;
  /** YYYY-MM-DD。exact のときだけ */
  postedDate: string | null;
  createdAt: Date | string;
};

/**
 * 2つの日付（YYYY-MM-DD）の日数の差。
 * @param from - 前の日付
 * @param to - 後の日付
 * @returns to − from の日数
 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * 参考投稿の鮮度（FR-098、research.md R6）。日付を入れていればその日、選んだだけなら登録日（日本時間）から
 * 7・30・90日前を投稿日とみなし、今日までの日数で 0〜30日は最新、31〜90日は現役、91日以上はアーカイブ。
 * @param post - 投稿日の選び方・投稿日・登録日時
 * @param today - 今日（日本時間の YYYY-MM-DD）
 * @returns 鮮度
 */
export function freshnessOf(post: FreshnessSource, today: string): Freshness {
  let posted: string | null = null;
  if (post.postedDateMode === "exact") posted = post.postedDate;
  else {
    const back = MODE_DAYS[post.postedDateMode];
    if (back !== undefined) posted = addDays(jstDateOf(new Date(post.createdAt)), -back);
  }
  if (posted === null) return "unknown";
  const days = daysBetween(posted, today);
  if (days <= FRESHNESS_LATEST_DAYS) return "latest";
  if (days <= FRESHNESS_ACTIVE_DAYS) return "active";
  return "archive";
}

/**
 * 投稿のプロンプトに入れる順に並べる（FR-099）。最新 → 現役 → 投稿日不明 → アーカイブ、同じ区分の中は登録の新しい順。
 * @param posts - 参考投稿
 * @param today - 今日（日本時間の YYYY-MM-DD）
 * @returns 並べた新しい配列
 */
export function sortForPrompt<T extends FreshnessSource>(posts: readonly T[], today: string): T[] {
  const rank = (p: T) => FRESHNESS_VALUES.indexOf(freshnessOf(p, today));
  return [...posts].sort((a, b) => rank(a) - rank(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * まとめての解説で使う短いID（FR-102）。IDの「-」を除いた先頭8文字で、同じアカウントの中で重なるなら、
 * 重ならない長さまで延ばす。
 * @param ids - そのアカウントの参考投稿のID（すべて）
 * @returns IDから短いIDへの対応
 */
export function shortIdsOf(ids: readonly string[]): Map<string, string> {
  const plain = ids.map((id) => [id, id.replace(/-/g, "").toLowerCase()] as const);
  const out = new Map<string, string>();
  for (const [id, hex] of plain) {
    let len = 8;
    while (len < hex.length && plain.some(([other, h]) => other !== id && h.startsWith(hex.slice(0, len)))) len += 1;
    out.set(id, hex.slice(0, len));
  }
  return out;
}

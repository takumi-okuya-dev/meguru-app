// リサーチの参考投稿・キーワードの手助け（specs/014-strategy-guidance research.md R6〜R8・R16）。
// 鮮度・プロンプトの並び・解説のプロンプトと取り出し・キーワードの案の取り出しを、APIとWebで共有する。
import { splitDrafts } from "./drafts";
import { FRESHNESS_ACTIVE_DAYS, FRESHNESS_LATEST_DAYS, REFERENCE_WHY_GOOD_MAX, SHORT_TEXT_MAX } from "./limits";
import { addDays, jstDateOf } from "./schedule";
import type { StrategyValues } from "./strategy";
import { countChars, isBlank, normalizeKeyword } from "./text";

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

/** 解説・キーワードの案のプロンプトに入れる課題の項目（FR-086・FR-101。入力のあるものだけ）。 */
const ACCOUNT_CONTEXT: [keyof StrategyValues, string][] = [
  ["purposeOrigin", "活動を始めたきっかけ"],
  ["purposeSelf", "活動を通して自分がなりたい姿"],
  ["purposeOthers", "関わった人にどうなってほしいか"],
  ["purposeFuture", "活動の先に作りたい未来"],
  ["purposeStance", "大切にしたい在り方・判断基準"],
  ["activityAxis", "活動の軸"],
  ["finalAction", "最終的に取ってほしい行動"],
  ["targetPersona", "届けたい人"],
  ["realWorries", "ターゲットの本音の悩み"],
  ["contentThemeMix", "発信テーマの掛け合わせ"],
  ["antiPersona", "来てほしくない人"],
];

/**
 * 課題のうち、指定の項目の入力のあるものを「- 見出し: 値」の行にする。
 * @param strategy - 課題の値
 * @param keys - 項目と見出し
 * @returns 行（入力がなければ空）
 */
function contextLines(strategy: StrategyValues, keys: [keyof StrategyValues, string][]): string[] {
  return keys.flatMap(([key, label]) => {
    const v = strategy[key];
    return typeof v === "string" && !isBlank(v) ? [`- ${label}: ${v.trim()}`] : [];
  });
}

/** 解説のプロンプトに入れる参考投稿の値。 */
export type ExplainSource = {
  shortId: string;
  body: string;
  keyword: string;
  postUrl: string;
  platform: ReferencePlatform;
  postedDateMode: PostedDateMode;
  postedDate: string | null;
  metrics: ReferenceMetrics;
  author: string;
  memo: string;
};

const unknown = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "不明" : String(v));

function postedDateText(p: ExplainSource): string {
  if (p.postedDateMode === "exact") return unknown(p.postedDate);
  if (p.postedDateMode === "unknown") return "不明";
  return POSTED_DATE_MODES.find((m) => m.value === p.postedDateMode)?.label ?? "不明";
}

/**
 * 参考投稿の解説のプロンプト（FR-086・FR-101、contracts/prompt-template.md 5）。
 * まとめてのときは、投稿ごとに【ID】を付け、「@@@」の行で区切って答えてもらう。
 * @param posts - 解説してもらう参考投稿（まとめてなら最大10件）
 * @param strategy - 課題の値
 * @param opts - batch：まとめての解説か
 * @returns プロンプト
 */
export function buildExplainPrompt(posts: readonly ExplainSource[], strategy: StrategyValues, opts: { batch: boolean }): string {
  const { batch } = opts;
  const blocks = posts.map((p) => {
    const lines = [
      ...(batch ? [`【ID:${p.shortId}】`] : []),
      "本文:",
      p.body,
      `媒体: ${REFERENCE_PLATFORMS.find((x) => x.value === p.platform)?.label ?? "不明"} ／ 元の投稿の投稿日: ${postedDateText(p)} ／ 投稿者: ${unknown(p.author)} ／ 投稿者のフォロワー数: ${unknown(p.metrics.followers)}`,
      `閲覧数: ${unknown(p.metrics.views)} ／ いいね: ${unknown(p.metrics.likes)} ／ コメント: ${unknown(p.metrics.replies)} ／ リポスト: ${unknown(p.metrics.reposts)} ／ 保存: ${unknown(p.metrics.saves)}`,
      `検索したキーワード: ${unknown(p.keyword)} ／ 投稿のURL: ${unknown(p.postUrl)} ／ 登録者のメモ: ${unknown(p.memo)}`,
    ];
    return lines.join("\n");
  });
  const account = contextLines(strategy, ACCOUNT_CONTEXT);
  return [
    "あなたは、Threads運用・コピーライティング・消費者心理に詳しい、SNSマーケティングの専門家です。",
    `ほかのアカウントで反応が良かったThreadsの投稿を${batch ? `${posts.length}件` : ""}分析し、「なぜ伸びたのか」を、読んだ人がすぐ理解できる形で説明してください。最終目的は、投稿者だから伸びた要素を取り除いて、別のテーマ・別のアカウントでも使える「再現できる型」にすることです。`,
    "",
    "■分析する投稿",
    blocks.join(batch ? "\n@@@\n" : "\n\n"),
    "",
    "■私たちのアカウント(このアカウントで使えるかを判断する材料)",
    ...(account.length > 0 ? account : ["(まだ書いていません。一般的な観点で判断してください)"]),
    "",
    "■判断の軸",
    "・一番バズった投稿が、一番参考になる投稿とは考えない。集めたい人に届くか × 再現できるか × 反応の質で判断する。",
    "・愚痴・批判・炎上・あおりなど、ネガティブな気持ちだけで伸びた投稿は、数字が大きくても型の対象にしない(最後に前向きに変わる投稿は参考にしてよい)。",
    "",
    `■出力の形(前置きなしで、この見出しのまま書く。1件${batch ? "400〜600字" : "800字程度"})`,
    ...(batch ? ["【ID:〇〇〇〇〇〇〇〇】(上の投稿のIDを、そのまま書き写す)"] : []),
    "【型の名前】「○○ × ○○型」の1行",
    "【なぜ伸びたか】重要な順に3つ。「何が(フック・言葉・構成) → 誰に → どう作用して → どんな反応になったか」を1〜2文で。",
    "【誰が反応したか】年代・状況・そのとき感じていたことを2文以内(根拠がなければ「不明」)。",
    "【このアカウントでの使い方】この型を、私たちのアカウントでどう使うかを1〜2文。",
    "【判定】○ 真似してOK ／ △ 条件付きでOK ／ × 真似しない のどれか1つと、理由を1文。",
    ...(batch ? ["投稿と投稿のあいだは、「@@@」だけの行で区切る。"] : []),
    "",
    "■ルール",
    "・数字・実績・事実を作らない。分からないことは「不明」と書く。",
    "・投稿の文章の言い換えで終わらせず、反応が生まれた構造を書く。",
  ].join("\n");
}

/** まとめての解説の答えを取り出せなかった理由（FR-103）。 */
export type ExplanationProblem = "not_found" | "already_explained" | "duplicate" | "empty" | "too_long";

/** まとめての解説の答えの1ブロック。 */
export type ParsedExplanation = { id: string | null; shortId: string | null; text: string; problem: ExplanationProblem | null };

const ID_LINE = /【\s*ID\s*[:：]\s*([0-9a-zA-Z]+)\s*】/;

/**
 * まとめての解説の答えを、参考投稿ごとの解説に分ける（FR-103）。
 * 「@@@」の行で分け、各ブロックの【ID:〜】で参考投稿を探し、【ID】を除いた残りを解説にする。
 * @param text - 貼り付けたAIの答え
 * @param posts - そのアカウントの参考投稿（ID・短いID・今のなぜ良いか）
 * @returns ブロックごとの結果（貼った順）
 */
export function parseExplanations(
  text: string,
  posts: readonly { id: string; shortId: string; whyGood: string }[],
): ParsedExplanation[] {
  const seen = new Set<string>();
  return splitDrafts(text).parts.map((block) => {
    const m = block.match(ID_LINE);
    const shortId = m ? m[1]!.toLowerCase() : null;
    const post = shortId ? posts.find((p) => p.shortId === shortId) : undefined;
    const body = (m ? block.replace(m[0], "") : block).trim();
    let problem: ExplanationProblem | null = null;
    if (!post) problem = "not_found";
    else if (!isBlank(post.whyGood)) problem = "already_explained";
    else if (seen.has(post.id)) problem = "duplicate";
    else if (body === "") problem = "empty";
    else if (countChars(body) > REFERENCE_WHY_GOOD_MAX) problem = "too_long";
    if (post && problem === null) seen.add(post.id);
    return { id: post?.id ?? null, shortId: post?.shortId ?? shortId, text: body, problem };
  });
}

/** キーワードの案のプロンプトに入れる課題の項目（specs/014 FR-090）。 */
const KEYWORD_CONTEXT: [keyof StrategyValues, string][] = [
  ["targetPersona", "届けたい人"],
  ["realWorries", "本音の悩み"],
  ["desiredSelfImage", "なりたい姿"],
  ["contentThemeMix", "発信テーマの掛け合わせ"],
  ["postGenres", "投稿ジャンル"],
];

/**
 * 検索するキーワードの案を、外部のAIに出してもらうプロンプト（specs/014 FR-090、contracts/prompt-template.md 6）。
 * @param strategy - 課題の値
 * @returns プロンプト
 */
export function buildKeywordIdeaPrompt(strategy: StrategyValues): string {
  const account = contextLines(strategy, KEYWORD_CONTEXT);
  return [
    "あなたは、Threadsのリサーチを手伝う相談相手です。下の私のアカウントの設計をもとに、Threadsの検索欄に入れると「集めたい人に届いて伸びている投稿」が見つかりそうな言葉の案を出してください。",
    "",
    "■私のアカウント",
    ...(account.length > 0 ? account : ["(まだ書いていません。Threadsでよく検索される、暮らし・仕事・人間関係の言葉から出してください)"]),
    "",
    "■お願い",
    "・短い言葉(1〜3語)を15〜20個。集めたい人が使いそうな言葉・その人の気持ちに近い言葉を中心にする。",
    "・1行に1つ、「キーワード｜狙い」の形で書く(例: 20代後半 友達｜社会人になって友達が増えない人の本音を探す)。",
    "・前置き・番号・見出しは書かない。",
  ].join("\n");
}

/** キーワードの案を登録できない理由（長すぎる・登録済み・一覧の中で重なる）。 */
export type KeywordIdeaProblem = "too_long" | "registered" | "duplicate";

/** 貼り付けた答えから取り出したキーワードの案。 */
export type KeywordIdea = { keyword: string; purpose: string; problem: KeywordIdeaProblem | null };

/** 行頭の番号・記号（1.・1)・①・・・-・#・*・>）と空白（\s は全角の空白も含む）。 */
const IDEA_PREFIX = /^\s*(?:(?:\d+|[①-⑳])[.)．）、]?|[・\-#*>•])?\s*/;

/**
 * 貼り付けた答えを1行ずつキーワードの案にする（specs/014 FR-091）。
 * 「｜」「|」の前をキーワード、後を狙い（なければ空）にし、行頭の番号・記号・空白を除く。空の行とコードブロックの区切りの行は捨てる。
 * @param text - 貼り付けた答え
 * @param registered - 登録済みのキーワード
 * @returns 案の一覧（答えの順）。登録できないものは problem に理由
 */
export function parseKeywordIdeas(text: string, registered: readonly string[]): KeywordIdea[] {
  const known = new Set(registered.map(normalizeKeyword));
  const seen = new Set<string>();
  const ideas: KeywordIdea[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) continue;
    const line = raw.replace(IDEA_PREFIX, "").trim();
    if (line === "") continue;
    const at = line.search(/[｜|]/);
    const keyword = (at < 0 ? line : line.slice(0, at)).trim();
    if (keyword === "") continue;
    const purpose = [...(at < 0 ? "" : line.slice(at + 1).trim())].slice(0, SHORT_TEXT_MAX).join("");
    const key = normalizeKeyword(keyword);
    const problem: KeywordIdeaProblem | null =
      countChars(keyword) > SHORT_TEXT_MAX ? "too_long" : known.has(key) ? "registered" : seen.has(key) ? "duplicate" : null;
    seen.add(key);
    ideas.push({ keyword, purpose, problem });
  }
  return ideas;
}

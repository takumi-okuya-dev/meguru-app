// 外部LLMに送るプロンプトの組み立て（specs/003-prompt-bulk-register contracts/prompt-template.md、research.md R1・R2・R12）。
// 文面の土台は参考プロダクトのプロンプト（reference-prompt.md）。
// 004でCORE RULESと却下された投稿の節を足した（specs/004-review-approval contracts/prompt-template.md、research.md R12）。
// 006の改善フィードバックの節も、ここに足す。
// 014で、最初に確認すること・忠実に反映・話題の配分・プロフィール・宣伝の書き方・最終チェックを足し、
// 件数を1か所で求めるようにした（specs/014-strategy-guidance contracts/prompt-template.md 1、research.md R10・R11）。
import {
  POST_LENGTH_DEFAULTS,
  PROMPT_LENGTH_TARGET,
  PROMPT_RECENT_DRAFTS,
  PROMPT_REFERENCE_POSTS,
  PROMPT_REJECTED_DRAFTS,
} from "./limits";
import { POLICY_PROMPT_RULES } from "./policy";
import { FRESHNESS_LEVELS, REFERENCE_PLATFORMS, type Freshness, type ReferenceMetrics, type ReferencePlatform } from "./research";
import type { PostLengthSettings, PromptSummary } from "./schemas";
import { countFilled, TONE_PRESETS, type StrategyValues } from "./strategy";
import { isBlank } from "./text";
import { THREADS_TEXT_LIMIT } from "./threads-text";

/** プロンプトに含める宣伝内容（宣伝の対象だけ。掲載期限の近い順、期限なしは最後、同じなら優先度の高い順）。 */
export type PromptPromotion = {
  /** 管理用のタイトル（014 FR-114） */
  title: string;
  /** 掲載期限（YYYY-MM-DD）。期限なしは null（014 FR-114） */
  validUntil: string | null;
  content: string;
  targetLocation: string;
  targetPersona: string;
  targetAgeRange: string;
  cta: string;
  linkedUrl: string | null;
};

/** プロンプトに含める参考投稿。媒体・数字・鮮度は014で足した（FR-115）。 */
export type PromptReferencePost = {
  body: string;
  keyword: string;
  whyGood: string;
  platform?: ReferencePlatform;
  metrics?: ReferenceMetrics;
  freshness?: Freshness;
};

/** プロンプトに含める却下の下書き（004）。reasonLabels は却下理由の候補の表示名。 */
export type PromptRejectedDraft = { body: string; reasonLabels: string[]; note: string | null };

/** 反応が低かった投稿（006 FR-026）。本文と傾向メモ。 */
export type PromptPoorPost = { body: string; memo: string | null };

/** buildPrompt の入力（contracts/prompt-template.md「入力」）。 */
export type PromptInput = {
  /** 作る件数（1〜50） */
  count: number;
  /** Accountの表示名（なければ @ユーザー名） */
  displayName: string;
  strategy: StrategyValues;
  promotions: PromptPromotion[];
  /** 宣伝投稿の割合（0〜100） */
  promotionRatioPercent: number;
  /** 新しい順。先頭の PROMPT_REFERENCE_POSTS 件まで使う */
  referencePosts: PromptReferencePost[];
  /** 投稿ストックの直近の下書き（要確認と承認済み）の本文。新しい順。先頭の PROMPT_RECENT_DRAFTS 件まで使う */
  recentDrafts: string[];
  /** 投稿ルール（CORE RULES）の空でない行（004） */
  coreRules: string[];
  /** NGワード（入力のままの表記。登録の古い順。004） */
  ngWords: string[];
  /** 却下の下書き。新しく却下した順。先頭の PROMPT_REJECTED_DRAFTS 件まで使う（004） */
  rejectedDrafts: PromptRejectedDraft[];
  /** 投稿の設定の時刻の数（0〜10。自動投稿のオン・オフは問わない。005 FR-024）。省略は0 */
  dailyPostCount?: number;
  /** 反応が低かった投稿。投稿の新しい順で、呼び出し側が最大 PROMPT_POOR_POSTS 件にする（006 FR-026）。省略は [] */
  poorPosts?: PromptPoorPost[];
  /** 今日の日付（日本時間、YYYY-MM-DD）。宣伝内容の残り日数に使う。省略すると残り日数を書かない（014 FR-114） */
  today?: string;
  /** 文字数と長さの割合。省略は POST_LENGTH_DEFAULTS（014 FR-140・FR-171） */
  lengthSettings?: PostLengthSettings;
};

/** プロンプトの中で使う件数（014 FR-118。冒頭の確認・各節・最終チェックで同じ値を使う）。 */
type Counts = {
  count: number;
  /** 宣伝投稿の件数（宣伝の節がなければ0） */
  promo: number;
  /** 型を使う件数（参考投稿が入らなければ0） */
  pattern: number;
  /** プロフィールや固定投稿へ誘う件数（下書きがなければ0） */
  invite: number;
  /** 短文・中文・長文の件数 */
  mix: [number, number, number];
  length: PostLengthSettings;
};

/**
 * 作る件数を、割合に合わせて短文・中文・長文に分ける（014 FR-141、research.md R11）。
 * 割合×件数の整数部分を配り、残りを端数の大きい順（同じなら短文 → 中文 → 長文）に配る。合計はいつも作る件数。
 * @param count - 作る件数
 * @param ratios - 短文・中文・長文の割合（合計100）
 * @returns 短文・中文・長文の件数
 */
export function splitLengthMix(count: number, ratios: [number, number, number]): [number, number, number] {
  const exact = ratios.map((r) => (count * r) / 100);
  const mix = exact.map(Math.floor) as [number, number, number];
  let rest = count - mix.reduce((a, b) => a + b, 0);
  const order = [0, 1, 2].sort((a, b) => exact[b]! - mix[b]! - (exact[a]! - mix[a]!) || a - b);
  for (const i of order) {
    if (rest <= 0) break;
    mix[i]! += 1;
    rest -= 1;
  }
  return mix;
}

/** 下書き（プロフィール・固定投稿）の見出し（014 FR-113）。 */
const PROFILE_PROMPT_LABELS = [
  ["profileBioDraft", "プロフィール文"],
  ["pinnedPostDraft1", "固定投稿①"],
  ["pinnedPostDraft2", "固定投稿②"],
  ["pinnedPostDraft3", "固定投稿③"],
] as const;

/** 話題の配分の指示を出す項目（014 FR-112）。 */
const TOPIC_KEYS = ["contentThemeMix", "postGenres", "realWorries", "desiredSelfImage"] as const;

const hasTopics = (strategy: StrategyValues) => TOPIC_KEYS.some((k) => !isBlank(strategy[k]));
const hasProfile = (strategy: StrategyValues) => PROFILE_PROMPT_LABELS.some(([k]) => !isBlank(strategy[k]));

/** 課題の項目のプロンプトでの見出し（prompt-template.md「アカウントの戦略設計」の順）。 */
const STRATEGY_PROMPT_LABELS = [
  ["finalAction", "最終的に取ってほしい行動"],
  ["targetPersona", "ターゲット"],
  ["realWorries", "ターゲットの本音の悩み"],
  ["desiredSelfImage", "ターゲットのなりたい姿"],
  ["perceivedImage", "このアカウントのどう見られたいか"],
  ["contentThemeMix", "発信テーマの掛け合わせ"],
  ["antiPersona", "来てほしくない人"],
  ["benchmarkAccounts", "ベンチマークにしたい他アカウント"],
  ["funnelDesign", "集客導線の設計"],
  ["postGenres", "投稿ジャンル"],
  ["dmReplyTemplate", "DM返信の型"],
  ["inquiryQualityTips", "問い合わせの質を上げるコツ"],
  ["tonePreset", "人柄(近い人間性)"],
  ["toneNotes", "文体の条件"],
  ["differentiation", "他アカウントとの違い"],
  ["successMetrics", "成功の指標"],
] as const;

/**
 * 「■絶対に守るルール(CORE RULES)」の節（004 FR-022・FR-041）。規約上のルールが常に入るので、節は省かない。
 * @param coreRules - 投稿ルールの空でない行
 * @param ngWords - NGワード
 * @returns 節の文面
 */
function coreRulesSection(coreRules: string[], ngWords: string[]): string {
  const lines = [...POLICY_PROMPT_RULES, ...coreRules].map((r) => `・${r}`);
  if (ngWords.length > 0) lines.push(`・次の言葉は使わないこと: ${ngWords.join("、")}`);
  return ["■絶対に守るルール(CORE RULES)", ...lines].join("\n");
}

/**
 * 「■過去に却下された投稿」の節（004 FR-023）。
 * @param drafts - 却下の下書き（含める分だけ）
 * @returns 節の文面
 */
function rejectedSection(drafts: PromptRejectedDraft[]): string {
  const items = drafts.map((d, i) => {
    const reason = [d.reasonLabels.join("・"), d.note ?? ""].filter((s) => s !== "").join(" / ");
    return `${i + 1}. ${d.body}(却下理由: ${reason})`;
  });
  return ["■過去に却下された投稿(この傾向は繰り返さないこと)", ...items].join("\n");
}

/**
 * 「■アカウントの戦略設計」の節。忠実に反映の指示（014 FR-111）と、話題の配分（FR-112）を含む。
 * @param strategy - 課題の値
 * @param count - 作る件数
 * @returns 節の文面、項目がどれも空なら null
 */
function strategySection(strategy: StrategyValues, count: number): string | null {
  const lines: string[] = [];
  for (const [key, label] of STRATEGY_PROMPT_LABELS) {
    if (key === "tonePreset") {
      const tone = TONE_PRESETS.find((t) => t.value === strategy.tonePreset);
      if (tone) lines.push(`${label}: ${tone.label}`);
    } else if (!isBlank(strategy[key])) {
      lines.push(`${label}: ${strategy[key]}`);
    }
  }
  if (lines.length === 0) return null;
  const topics = hasTopics(strategy)
    ? [
        "【話題の配分(必ず守る)】",
        `上の「発信テーマの掛け合わせ」「投稿ジャンル」「ターゲットの本音の悩み」「ターゲットのなりたい姿」に出てくる主な話題を、${count}件の中に、すべて最低1件ずつ入れること。1つの話題が、全体の4割を超えないようにすること。投稿ジャンルに割合や件数が書かれている場合は、その配分どおりにすること。`,
      ]
    : [];
  return [
    "■アカウントの戦略設計(設定済みの項目。方向性として必ず踏まえること)",
    "ここに書かれているのは、本人が決めた方針です。要約したり一部だけ使ったりせず、言葉づかい・禁止事項・例文・箇条書きのニュアンスまで忠実に反映すること。「来てほしくない人」やCORE RULESと食い違う内容は書かないこと。文体・人柄の指定が、下の共通ルール(語尾・改行など)と食い違うときは、文体・人柄を優先する(ただし、文字数・区切り「@@@」・NGワード・CORE RULESは必ず守る)。",
    ...lines,
    ...topics,
  ].join("\n");
}

/** 活動の目的・在り方の見出し（specs/014 FR-053）。 */
const PURPOSE_PROMPT_LABELS = [
  ["purposeOrigin", "活動を始めたきっかけ"],
  ["purposeSelf", "活動を通して自分がなりたい姿"],
  ["purposeOthers", "関わった人にどうなってほしいか"],
  ["purposeFuture", "活動の先に作りたい未来"],
  ["purposeStance", "大切にしたい在り方・判断基準"],
  ["activityAxis", "活動の軸"],
] as const;

/**
 * 「■活動の目的・在り方」の節（specs/014 FR-053）。入力のある答えだけを並べ、どれも空なら節ごと入れない。
 * 長さの調整では削らない（FR-117）。
 * @param strategy - 課題の値
 * @returns 節の文面、どれも空なら null
 */
function purposeSection(strategy: StrategyValues): string | null {
  const lines = PURPOSE_PROMPT_LABELS.filter(([key]) => !isBlank(strategy[key])).map(
    ([key, label]) => `- ${label}: ${strategy[key].trim()}`,
  );
  if (lines.length === 0) return null;
  return [
    "■活動の目的・在り方(本人の言葉。投稿の方向性・判断基準として踏まえ、これと矛盾する内容は書かないこと)",
    ...lines,
  ].join("\n");
}

/**
 * 「■現在のプロフィールと固定投稿」の節（014 FR-113）。入力のある下書きだけを並べる。長さの調整では削らない（FR-117）。
 * @param strategy - 課題の値
 * @param c - 件数
 * @returns 節の文面、下書きがどれも空なら null
 */
function profileSection(strategy: StrategyValues, c: Counts): string | null {
  const drafts = PROFILE_PROMPT_LABELS.filter(([key]) => !isBlank(strategy[key])).map(
    ([key, label]) => `- ${label}:\n${strategy[key].trim()}`,
  );
  if (drafts.length === 0) return null;
  return [
    "■現在のプロフィールと固定投稿(このアカウントの軸。すべての投稿の方向性の基準)",
    ...drafts,
    "【使い方】",
    "・プロフィールが示す「誰に・何を・どんな価値を届けるか」を軸にして、各投稿を書く。プロフィールの約束と関係ない話題、トーンが食い違う話題は作らない。文章そのものはコピーしない。",
    `・${c.count}件のうち${c.invite}件は、文末で、プロフィールや固定投稿へ自然に誘う一言を添える(毎回違う言い方にする。URLは書かない。宣伝投稿とは別の投稿にする)。`,
  ].join("\n");
}

/**
 * 今日から掲載期限の日までの日数（当日は0日）。
 * @param today - 今日（YYYY-MM-DD）
 * @param until - 掲載期限（YYYY-MM-DD）
 * @returns 日数
 */
function daysUntil(today: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function promotionLine(p: PromptPromotion, i: number, today: string | undefined): string {
  const target = [
    ["場所", p.targetLocation],
    ["どんな人", p.targetPersona],
    ["年齢", p.targetAgeRange],
  ]
    .filter(([, v]) => !isBlank(v!))
    .map(([k, v]) => `${k}: ${v}`);
  const title = isBlank(p.title) ? "" : `【${p.title.trim()}】`;
  const until =
    p.validUntil === null
      ? "(期限なし)"
      : `(掲載期限: ${p.validUntil}${today ? `・残り${daysUntil(today, p.validUntil)}日` : ""})`;
  let line = `${i + 1}. ${title}${until} ${p.content}`;
  if (target.length > 0) line += `(届けたい相手: ${target.join(" / ")})`;
  if (!isBlank(p.cta)) line += ` / 行動喚起: ${p.cta}`;
  if (p.linkedUrl) line += ` / 専用URL: ${p.linkedUrl}`;
  return line;
}

/**
 * 宣伝内容の並び順と偏りの指示。「1〜2件に偏らせない」は3件以上のときだけ出す（1〜2件では守れない指示になる）。
 * @param n - 宣伝内容の件数
 * @returns 指示の行
 */
function promotionGuidance(n: number): string[] {
  if (n >= 3) {
    return [
      "掲載期限が近い順に並んでいます。期限が近いものはやや多めに扱ってよいが、一部だけに偏らせないこと。期限未設定のものも含め、下に掲載している宣伝内容全体をきちんと扱うこと。",
      `下に${n}件掲載している宣伝内容のうち、特定の1〜2件だけに偏らせないこと。`,
    ];
  }
  if (n === 2)
    return [
      "掲載期限が近い順に並んでいます。期限が近いものはやや多めに扱ってよいが、2件ともきちんと扱うこと。",
    ];
  return [];
}

/**
 * 「■今回組み込む宣伝内容」の節。宣伝投稿の件数をちょうどN件で示し、タイトル・期限と宣伝投稿の書き方を含む（014 FR-114・FR-172）。
 * @param input - 材料
 * @param c - 件数
 * @returns 節の文面
 */
function promotionSection(input: PromptInput, c: Counts): string {
  const ratio = input.promotionRatioPercent;
  const daily = input.dailyPostCount ?? 0;
  const dailyLine =
    daily > 0
      ? [
          `宣伝投稿の割合は${ratio}%の設定です。1日の投稿は${daily}件の設定で、そのうち${Math.max(1, Math.round((daily * ratio) / 100))}件程度が宣伝投稿になります。`,
        ]
      : [];
  return [
    `■今回組み込む宣伝内容(${c.count}件のうち、宣伝投稿はちょうど${c.promo}件。残りの${c.count - c.promo}件は宣伝の行動喚起を入れない通常投稿にすること)`,
    ...dailyLine,
    ...promotionGuidance(input.promotions.length),
    "同じ宣伝内容を続けて扱わないこと。",
    ...input.promotions.map((p, i) => promotionLine(p, i, input.today)),
    "",
    "宣伝を含む投稿でも、押し売り・広告っぽい言い回しにはせず、上記のCORE RULES・トーンをそのまま守ること。「届けたい相手」に書かれた属性を意識した切り口にすること。",
    `【宣伝投稿の書き方(宣伝内容を扱う${c.promo}件に必ず適用する)】`,
    "・構成: ①思わず目が止まる1行目(いきなり告知から始めない) → ②読者が自分ごとになる一言 → ③中身(日時・場所・料金・内容は、上の宣伝内容に書かれている事実だけを使う) → ④読者が次にすることを伝える誘導の一言。",
    "・1〜2文ごとに改行し、長い文を作らない。「ぜひご参加ください」「お待ちしております」のような広告の定型文は使わない。",
    "・行動喚起は、そのまま写さず本人の言葉に言い換え、投稿ごとに違う言い回しにする。行動喚起が空の宣伝内容は、コメント・保存などのどれか1つだけを軽く促す。",
    "・同じ宣伝内容でも、切り口を変えて別の投稿にする。",
  ].join("\n");
}

/** 参考投稿に添える数字の見出し（わからない数字は書かない。014 FR-115）。 */
const METRIC_PROMPT_LABELS = [
  ["views", "閲覧"],
  ["likes", "いいね"],
  ["replies", "コメント"],
  ["reposts", "リポスト"],
  ["saves", "保存"],
  ["followers", "フォロワー"],
] as const;

/**
 * 参考投稿の角かっこの添え書き（検索語・鮮度・媒体（Threads以外）・分かっている数字）。
 * @param p - 参考投稿
 * @returns 「 [..]」、添えるものがなければ空
 */
function referenceTags(p: PromptReferencePost): string {
  const tags: string[] = [];
  if (!isBlank(p.keyword)) tags.push(`検索語:${p.keyword}`);
  if (p.freshness) tags.push(FRESHNESS_LEVELS.find((f) => f.value === p.freshness)!.label);
  if (p.platform && p.platform !== "threads") tags.push(REFERENCE_PLATFORMS.find((x) => x.value === p.platform)!.label);
  for (const [key, label] of METRIC_PROMPT_LABELS) {
    const v = p.metrics?.[key];
    if (v !== null && v !== undefined) tags.push(`${label} ${v.toLocaleString("en-US")}`);
  }
  return tags.length > 0 ? ` [${tags.join("・")}]` : "";
}

function researchSection(c: Counts, posts: PromptReferencePost[]): string {
  const items = posts.map((p, i) => {
    const quote = p.body
      .trim()
      .split("\n")
      .map((l) => `   > ${l}`.trimEnd());
    const why = isBlank(p.whyGood) ? "(分析メモなし。フック・構成・感情の動かし方を自分で読み取ること)" : p.whyGood;
    return [`${i + 1}. 元の投稿(参考: 内容はコピーしない)${referenceTags(p)}`, ...quote, `   なぜ良いか: ${why}`].join("\n");
  });
  return [
    "■リサーチで見つけた「伸びている投稿」とその分析(型・構成の最重要参考資料)",
    "これは実際にThreadsで見つかった、反応が良かった他アカウントの投稿と、その分析結果です。以下の手順で必ず活用すること。",
    "",
    "手順1: 一覧の中から、今回のテーマに合いそうなものを何件か選ぶ。",
    "手順2: 選んだ投稿の分析結果(フック・構成・感情の動かし方)を読み、そこで使われている「型」を言葉で抜き出す。",
    "       例: 「疑問形で終わる」「具体的な数字から入る」「結論を先に言ってから理由を続ける」「あるあるを2〜3個並べてから本題に入る」など。",
    "手順3: 抜き出した「型」に、このアカウント自身の知識・エピソード・言葉遣いを当てはめて新しい投稿を書く。",
    "       元の投稿の文章・具体的なエピソード・固有名詞はそのまま使わない(著作権・盗用の問題になるため絶対禁止)。あくまでフックの作り方・構成の順番・テンポだけを借りること。",
    `手順4: ${c.count}件のうち、最低でも${c.pattern}件はこの手順で明確に「型」を踏襲した投稿にすること。同じ参考投稿から何度も型を借りず、なるべく異なる投稿から1件ずつ借りること。新しい参考投稿を優先すること。どの型を使ったかが分かるように、フック文の作り方に反映させること。`,
    "",
    ...items,
  ].join("\n");
}

function dedupeSection(count: number, drafts: string[], withRejected: boolean): string {
  const lines = [
    "■重複防止(絶対厳守。最も重要なルールの1つ)",
    `- ${count}件それぞれ、言いたい核(結論・メッセージ)を1行で要約したときに、他のどれとも被らないこと。書き出しや言い回しを変えただけの「実質同じ投稿」は禁止。`,
    `- 上に書かれている${withRejected ? "却下された投稿・" : ""}宣伝内容・リサーチ内容${drafts.length > 0 ? "、下に並べた投稿ストックの下書き" : ""}とも、核となる話題やエピソードが重複しないこと。同じテーマを扱う場合も、切り口・具体例・結論を変えて別物にすること。`,
    `- 生成の最後に、${count}件同士を見比べて「言いたいことが似すぎているペア」が無いか自分で確認し、あれば書き直してから出力すること。`,
  ];
  if (drafts.length > 0) {
    lines.push(
      "",
      "投稿ストックにある直近の下書き(これらと核が被らないこと):",
      ...drafts.map((d, i) => `${i + 1}. ${d}`),
    );
  }
  return lines.join("\n");
}

/** 短文・中文・長文の役割の説明（003の文面のまま）。 */
const LENGTH_KINDS = [
  ["短文", "shortLength", "1〜2文で、説明せず言い切るタイプ。一撃で「わかる」「それな」と思わせる一言・あるある・問いかけだけで完結させる。背景説明やオチの解説はつけない。"],
  ["中文", "mediumLength", "3〜5文で、「気づき→展開→軽い着地」の小さな流れを作る。最初の一文で状況や違和感を提示し、そこから思ったことを1段展開し、最後に前向きな一言か問いかけで締める。"],
  ["長文", "longLength", "改行多めで、「状況→心境の変化→今どう思っているか」のミニストーリー構成を、短い文を細かく改行で区切ることで作る。文字数自体は中文とあまり変えず、行間の余白・テンポで「読ませる長さ」を演出する。説明的にならず、実体験を話しているような温度感にする。"],
] as const;

/**
 * 「■短文・中文・長文」の節。件数の内訳と、各長さの±20%の幅（上限は目標まで）を設定から作る（014 FR-171）。
 * @param c - 件数
 * @returns 節の文面
 */
function lengthMixSection(c: Counts): string {
  const { length: l, mix } = c;
  const kinds = LENGTH_KINDS.flatMap(([name, key, role], i) => {
    if (mix[i] === 0) return [];
    const len = l[key];
    return [`- ${name}(だいたい${len}文字(${Math.round(len * 0.8)}〜${Math.min(l.target, Math.round(len * 1.2))}文字)): ${role}`];
  });
  return [
    "■短文・中文・長文は「長さ」だけでなく「役割」も変える(必ず守ること)",
    `${c.count}件の内訳: 短文${mix[0]}件・中文${mix[1]}件・長文${mix[2]}件(割合は${l.shortRatio}:${l.mediumRatio}:${l.longRatio})。同じ役割の投稿を3件以上連続させないこと。`,
    `いずれのタイプも、下の「■文字数について」の目安(${l.target}文字以内)を必ず守ること。「長文」は文字数を増やすのではなく、改行の使い方・構成で「長さ・重み」を感じさせること。`,
    ...kinds,
    `- 冒頭の切り口(フック)も毎回変えること。例: 断言から始める/問いかけから始める/具体的な場面描写から始める/数字から始める/「〜な人へ」という呼びかけから始める/意外性のある一言から始める/エピソードの結末から先に言う、など。同じフックのパターンを${c.count}件のうち3件以上連続で使わないこと。`,
  ].join("\n");
}

/**
 * 「■文字数について」の節。目標×0.85前後をめざし、超えても目標×1.35まで（500文字まで）（014 FR-171）。
 * @param c - 件数
 * @returns 節の文面
 */
function charCountSection(c: Counts): string {
  const { target } = c.length;
  const aim = Math.round(target * 0.85);
  const max = Math.min(THREADS_TEXT_LIMIT, Math.round(target * 1.35));
  return [
    "■文字数について(必ず守ること)",
    "Threadsの1投稿の上限は500文字で、絵文字だけは1文字ではなくUTF-8のバイト数(多くは4)で数えられる。上限を超えると投稿できない。",
    `- 改行・絵文字・記号もすべて含めた本文全体を、${target}文字以内におさめること(${aim}文字前後を目標にする)。内容の都合でどうしても収まらないときも、${max}文字までにすること。500文字は絶対に超えないこと。`,
    "- 絵文字は1投稿につき合計3個までにすること。",
    "- リンク(URL)は1投稿につき5個までにすること。",
    `- 生成の最後に、${c.count}件それぞれの本文を改行・絵文字含めて数え、${max}文字を超えているものが無いか自分で確認し、超えていれば必ず削って出力すること。`,
  ].join("\n");
}

function outputSection(count: number): string {
  return [
    "■出力形式(必ず守ること。最後の1件まで絶対に崩さないこと。今回最も間違えやすいルールなので特に注意すること)",
    `- 出力全体(全${count}件と「@@@」の行)を、1つのコードブロック(バッククォート3つ「\`\`\`」で始まり「\`\`\`」で終わる枠)の中に入れること。コードブロックの外には、何も書かない。理由: コピーしたときに、改行と「@@@」の行が崩れずに残るため。コードブロックは出力全体で1つだけにし、投稿ごとに分けないこと。`,
    "- 説明文・前置き・タイトル・番号付けは不要。投稿本文だけを出力すること。",
    "- 各投稿の間には、必ず「@@@」だけの行(半角アットマークを3つだけ、前後にスペースや他の文字を一切付けない、独立した1行)を挟むこと。",
    '  - "@@@"を指定している理由: "---"のような記号は、AIのチャット画面によってはMarkdownの装飾(区切り線)として画面上に表示され、コピーした時にその区切り線自体が消えてしまうことがある(結果、複数の投稿が1件にくっついてしまう)。"@@@"はそのような装飾として扱われないため、必ずこちらを使うこと。',
    "  - 使ってよい区切りはこの半角アットマーク3つだけ。ハイフン「---」、全角ハイフン「－」、emダッシュ「—」、アスタリスク「***」、太字「**@@@**」、コード表記「`@@@`」、「1.」「①」のような番号付け、見出し記号は絶対に使わないこと。",
    "  - 正しい例:",
    "    投稿Aの本文はここまで。",
    "    @@@",
    "    投稿Bの本文はここから。",
    "  - 間違った例(絶対にしないこと): 「1. 投稿Aの本文」「投稿A",
    "",
    "投稿B」(空行だけで区切る)「---」「―――」(全角・emダッシュ)「**@@@**」",
    `  - ${count}件なら区切り線はちょうど${count - 1}個になる。出力の最後に区切り線の数を自分で数え、${count - 1}個になっているか必ず確認すること。足りない・多い場合は出力し直すこと。この確認は絶対に省略しないこと。`,
    "- 投稿本文の中でも、見出し「# 」「## 」、太字「**text**」「__text__」、インラインコード「`text`」などのMarkdown装飾は一切使わないこと。Threadsはこれらを装飾として表示せず、そのまま記号として表示してしまうため、記号だけが本文に残って見苦しくなる。強調したい場合は記号を使わず、言葉選びや改行だけで表現すること。",
    "- 上から目線で教えない。「〜すべき」「〜しなさい」は使わない。「〜な気がする」「〜かもしれない」など柔らかい語尾を使う。",
    "- 存在しないエピソード・実績・日時・会話を作らない。事実は上記に書かれているものだけを使う。",
    "- 炎上商法・対立煽り・断定的な誇張はしない。",
    "- 読者を否定せず、ネガティブなまま終わらせない。着地点は必ず前向きな一言、または気軽に答えられる質問にする。",
    "- AIっぽい整いすぎた文章にしない。改行を増やし、人間の話し言葉に近づける。",
    "",
    `生成できたら、この出力をまるごとコピーして、ThreadsGrowerの「投稿をつくる」の画面にある貼り付け欄に1回で貼り付けてください。"@@@"の行で自動的に${count}件に分割して登録されます(1件ずつコピーし直す必要はありません)。`,
  ].join("\n");
}

/**
 * 冒頭の「【最初に確認すること(最重要)】」と、ルールがぶつかったときの優先順位（014 FR-110）。
 * @param c - 件数
 * @returns 文面
 */
function firstCheckSection(c: Counts): string {
  const promo = c.promo > 0 ? `（うち宣伝投稿${c.promo}件・通常投稿${c.count - c.promo}件）` : "";
  return [
    "【最初に確認すること(最重要)】",
    `① 投稿は、ちょうど${c.count}件${promo}。② 投稿と投稿の間は「@@@」だけの行で区切る。③ 1件は${c.length.target}文字以内(500文字は絶対に超えない)。`,
    "【ルールがぶつかったときの優先順位】出力のルール ＞ 宣伝投稿の件数 ＞ CORE RULES・NGワード・事実を作らない ＞ 戦略設計(人柄・文体・話題) ＞ 参考情報(リサーチ・投稿ストックの下書き)",
  ].join("\n");
}

/**
 * 末尾の「■出力する前の最終チェック」。材料のある行だけを並べる（014 FR-116、SC-016）。
 * @param c - 件数
 * @param has - 材料のある節
 * @returns 節の文面
 */
function finalCheckSection(c: Counts, has: { strategy: boolean; purpose: boolean; topics: boolean }): string {
  const material = [has.strategy ? "「戦略設計」" : "", has.purpose ? "「活動の目的・在り方」" : ""].filter((s) => s !== "");
  const lines = [
    "■出力する前の最終チェック(次を1つずつ確認して、足りないところは直してから出力すること)",
    `□ 投稿は、ちょうど${c.count}件になっている(区切り「@@@」は${c.count - 1}個)。短文${c.mix[0]}件・中文${c.mix[1]}件・長文${c.mix[2]}件。`,
    `□ 1件ずつ、${c.length.target}文字以内(500文字は絶対に超えない)。`,
  ];
  if (material.length > 0) lines.push(`□ 上の${material.join("と")}の内容が、投稿に表れている。`);
  if (has.topics) lines.push("□ 「発信テーマ」「投稿ジャンル」などに書かれた話題が、すべて最低1件ずつ入っている。");
  if (c.promo > 0) lines.push(`□ 宣伝投稿がちょうど${c.promo}件あり、そのすべてに、投稿ごとに違う言い回しの誘導の一言がある。`);
  if (c.pattern > 0) lines.push(`□ リサーチの「型」を使った投稿が、少なくとも${c.pattern}件ある。`);
  if (c.invite > 0) lines.push(`□ プロフィールや固定投稿へ誘う投稿が${c.invite}件ある(宣伝投稿とは別)。`);
  lines.push("□ 同じ内容・同じ書き出しの投稿がない。ネガティブなまま終わる投稿がない。");
  return lines.join("\n");
}

type Parts = { posts: PromptReferencePost[]; drafts: string[]; rejected: PromptRejectedDraft[] };

/**
 * プロンプトの件数を1か所で求める（014 FR-118、contracts/prompt-template.md 1「件数」）。
 * @param input - 材料
 * @param posts - 実際に入る参考投稿
 * @param withPromotions - 宣伝の節を入れるか
 * @returns 件数
 */
function promptCounts(input: PromptInput, posts: PromptReferencePost[], withPromotions: boolean): Counts {
  const { count } = input;
  const length = input.lengthSettings ?? POST_LENGTH_DEFAULTS;
  return {
    count,
    promo: withPromotions ? Math.max(1, Math.round((count * input.promotionRatioPercent) / 100)) : 0,
    pattern: posts.length > 0 ? Math.min(count, Math.max(3, Math.ceil(posts.length * 1.2))) : 0,
    invite: hasProfile(input.strategy) ? Math.max(1, Math.round(count / 10)) : 0,
    mix: splitLengthMix(count, [length.shortRatio, length.mediumRatio, length.longRatio]),
    length,
  };
}

function assemble(
  input: PromptInput,
  { posts, drafts, rejected }: Parts,
  withPromotions: boolean,
): string {
  const c = promptCounts(input, posts, withPromotions);
  const strategy = strategySection(input.strategy, c.count);
  const purpose = purposeSection(input.strategy);
  const sections = [
    `以下の情報をもとに、Threadsに投稿する文章を${c.count}件作ってください。`,
    firstCheckSection(c),
    `■話者\n表示名: ${input.displayName}`,
    coreRulesSection(input.coreRules, input.ngWords),
    strategy,
    purpose,
    profileSection(input.strategy, c),
    withPromotions ? promotionSection(input, c) : null,
    rejected.length > 0 ? rejectedSection(rejected) : null,
    // 長さの調整で減らさない（006 contracts/prompt-template.md、Constitution原則VI）
    (input.poorPosts ?? []).length > 0 ? poorSection(input.poorPosts!) : null,
    posts.length > 0 ? researchSection(c, posts) : null,
    dedupeSection(c.count, drafts, rejected.length > 0),
    lengthMixSection(c),
    charCountSection(c),
    outputSection(c.count),
    finalCheckSection(c, {
      strategy: strategy !== null,
      purpose: purpose !== null,
      topics: strategy !== null && hasTopics(input.strategy),
    }),
  ];
  return sections.filter((s): s is string => s !== null).join("\n\n");
}

/**
 * 戦略プロファイルと投稿ストックから、外部LLMに送るプロンプトを組み立てる（FR-002・FR-003・FR-008）。
 * 全文が PROMPT_LENGTH_TARGET 文字を超えるときは、直近の下書き → 却下の下書き → 参考投稿の順に、古いものから減らして収める
 * （003 R12、004 R12）。CORE RULESの節と、014で足した節は減らさない（014 FR-117）。
 * @param input - 材料
 * @returns 全文、実際に含めた材料の数、全文の文字数（コードポイント）
 */
export function buildPrompt(input: PromptInput): { prompt: string; summary: PromptSummary; length: number } {
  const withPromotions = input.promotions.length > 0 && input.promotionRatioPercent >= 1;
  const parts: Parts = {
    posts: input.referencePosts.slice(0, PROMPT_REFERENCE_POSTS),
    drafts: input.recentDrafts.slice(0, PROMPT_RECENT_DRAFTS),
    rejected: input.rejectedDrafts.slice(0, PROMPT_REJECTED_DRAFTS),
  };
  let prompt = assemble(input, parts, withPromotions);
  let length = [...prompt].length;
  while (
    length > PROMPT_LENGTH_TARGET &&
    (parts.drafts.length > 0 || parts.rejected.length > 0 || parts.posts.length > 0)
  ) {
    if (parts.drafts.length > 0) parts.drafts = parts.drafts.slice(0, -1);
    else if (parts.rejected.length > 0) parts.rejected = parts.rejected.slice(0, -1);
    else parts.posts = parts.posts.slice(0, -1);
    prompt = assemble(input, parts, withPromotions);
    length = [...prompt].length;
  }
  const { posts, drafts, rejected } = parts;
  return {
    prompt,
    length,
    summary: {
      strategyFilledCount: countFilled(input.strategy),
      promotionCount: withPromotions ? input.promotions.length : 0,
      referencePostCount: posts.length,
      recentDraftCount: drafts.length,
      length,
      coreRuleCount: input.coreRules.length,
      ngWordCount: input.ngWords.length,
      rejectedCount: rejected.length,
      dailyPostCount: input.dailyPostCount ?? 0,
      poorPostCount: (input.poorPosts ?? []).length,
    },
  };
}

/**
 * 「■反応が低かった投稿」の節（006 FR-025・FR-026、contracts/prompt-template.md）。
 * @param posts - 反応が低かった投稿（投稿の新しい順）
 * @returns 節の文面
 */
function poorSection(posts: PromptPoorPost[]): string {
  const items = posts.map((p, i) => `${i + 1}. ${p.body}${p.memo ? `(傾向メモ: ${p.memo})` : ""}`);
  return [
    "■反応が低かった投稿(このアカウントで閲覧数が基準の半分以下だった投稿。同じ書き方・切り口は避けること)",
    ...items,
  ].join("\n");
}

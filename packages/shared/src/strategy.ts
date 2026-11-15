// 課題（戦略設計）の項目の定義と文言（specs/002-strategy-profile data-model.md「strategy_designs」、contracts/ui-routes.md「項目の文言」）。
// 画面の描画、API の検証、後続のプロンプト生成が、この1つの定義を使う。
import { isBlank } from "./text";

/** 近い人間性の選択肢（data-model.md の tone_preset）。 */
export const TONE_PRESETS = [
  { value: "energetic_casual", label: "元気・カジュアル" },
  { value: "polite_warm", label: "丁寧・温かい" },
  { value: "formal", label: "敬語ベース" },
  { value: "casual_frank", label: "ため口・フランク" },
  { value: "introspective_calm", label: "内省的・静かめ" },
  { value: "passionate", label: "情熱的・熱量高め" },
  { value: "humorous", label: "ユーモア・自虐混じり" },
] as const;

/** 近い人間性の値。 */
export type TonePreset = (typeof TONE_PRESETS)[number]["value"];

/** 近い人間性の値の一覧（zod の enum 用）。 */
export const TONE_PRESET_VALUES = TONE_PRESETS.map((t) => t.value) as unknown as readonly [TonePreset, ...TonePreset[]];

/** 活動の目的・在り方の5問と活動の軸のキー（specs/014 research.md R3）。PUT では省略でき、省略は今の値を残す。 */
export const PURPOSE_KEYS = [
  "purposeOrigin",
  "purposeSelf",
  "purposeOthers",
  "purposeFuture",
  "purposeStance",
  "activityAxis",
] as const;

/** 活動の目的・在り方の5問と活動の軸のキー。 */
export type PurposeKey = (typeof PURPOSE_KEYS)[number];

/** 課題のテキストの項目のキー（DB の列名を camelCase にしたもの）。 */
export const STRATEGY_TEXT_KEYS = [
  ...PURPOSE_KEYS,
  "finalAction",
  "targetPersona",
  "realWorries",
  "desiredSelfImage",
  "perceivedImage",
  "contentThemeMix",
  "antiPersona",
  "benchmarkAccounts",
  "funnelDesign",
  "postGenres",
  "dmReplyTemplate",
  "inquiryQualityTips",
  "toneNotes",
  "differentiation",
  "successMetrics",
  "profileBioDraft",
  "pinnedPostDraft1",
  "pinnedPostDraft2",
  "pinnedPostDraft3",
] as const;

/** 課題のテキストの項目のキー。 */
export type StrategyTextKey = (typeof STRATEGY_TEXT_KEYS)[number];

/** 課題の全項目の値。テキストの未入力は ""、近い人間性の未選択は null。 */
export type StrategyValues = Record<StrategyTextKey, string> & { tonePreset: TonePreset | null };

/** 課題の区分（specs/014 FR-019 で「課題①〜③」の番号を外し、活動の目的・在り方を先頭に足した）。 */
export const STRATEGY_SECTIONS = [
  { id: "purpose", title: "活動の目的・在り方", chip: "目的" },
  { id: "sales", title: "営業導線設計", chip: "営業導線" },
  { id: "account", title: "アカウント設計", chip: "アカウント" },
  { id: "funnel", title: "集客導線設計", chip: "集客導線" },
  { id: "tone", title: "人柄（トンマナ）", chip: "人柄" },
  { id: "other", title: "その他", chip: "その他" },
  { id: "drafts", title: "プロフィール・固定投稿（下書き）", chip: "下書き" },
] as const;

/** 課題の区分の ID。 */
export type StrategySectionId = (typeof STRATEGY_SECTIONS)[number]["id"];

/** 課題の1項目の定義。 */
export type StrategyField = {
  key: StrategyTextKey | "tonePreset";
  /** DB の列名（data-model.md） */
  column: string;
  kind: "text" | "select";
  section: StrategySectionId;
  label: string;
  description: string;
  /** 記入例（空の欄の中に出す。保存しない） */
  placeholder: string;
  /** 入力済み項目数（16項目）に数えるか。目的の6項目と下書き4項目は数えない（FR-005、specs/014 FR-020） */
  counted: boolean;
  rows: number;
};

/** 活動の目的・在り方の5問と活動の軸（specs/014 FR-050・FR-051。記入例は contracts/hints.md の例）。 */
const PURPOSE_FIELDS: readonly StrategyField[] = [
  {
    key: "purposeOrigin",
    column: "purpose_origin",
    kind: "text",
    section: "purpose",
    label: "Q1：なぜ、この活動を始めようと思いましたか？",
    description: "きっかけになった出来事や、そのときの気持ち",
    placeholder: "例: 上京して、仕事以外で話せる人がいなかった",
    counted: false,
    rows: 3,
  },
  {
    key: "purposeSelf",
    column: "purpose_self",
    kind: "text",
    section: "purpose",
    label: "Q2：この活動を通して、自分自身はどうなりたいですか？",
    description: "活動を続けた先の、自分の姿",
    placeholder: "例: 人と人をつなぐ役として頼られる",
    counted: false,
    rows: 3,
  },
  {
    key: "purposeOthers",
    column: "purpose_others",
    kind: "text",
    section: "purpose",
    label: "Q3：関わってくれた人に、どうなってほしいですか？",
    description: "あなたと関わった人の、その後の変化",
    placeholder: "例: 会社以外にも、気軽に話せる友達ができる",
    counted: false,
    rows: 3,
  },
  {
    key: "purposeFuture",
    column: "purpose_future",
    kind: "text",
    section: "purpose",
    label: "Q4：この活動を続けた先に、どんな未来を作りたいですか？",
    description: "自分と周りを超えた、少し大きな景色",
    placeholder: "例: 地方から上京した人が、孤立しない街",
    counted: false,
    rows: 3,
  },
  {
    key: "purposeStance",
    column: "purpose_stance",
    kind: "text",
    section: "purpose",
    label: "Q5：活動するうえで、どんな在り方を大切にしたいですか？",
    description: "発信や人との関わりで、守りたい姿勢",
    placeholder: "例: 無理に売り込まない。本音で話す",
    counted: false,
    rows: 3,
  },
  {
    key: "activityAxis",
    column: "activity_axis",
    kind: "text",
    section: "purpose",
    label: "活動の軸",
    description: "Q1〜Q5の答えを、短い言葉にまとめたもの。投稿やプロフィールの言葉を選ぶときの芯になります",
    placeholder: "例: ひとりで頑張る人を、ひとりにしない",
    counted: false,
    rows: 2,
  },
];

/** 課題の26項目（表示順）。目的の6項目・数える16項目・下書き4項目。 */
export const STRATEGY_FIELDS: readonly StrategyField[] = [
  ...PURPOSE_FIELDS,
  {
    key: "finalAction",
    column: "final_action",
    kind: "text",
    section: "sales",
    label: "最終的に読者に取ってほしい行動",
    description: "投稿を見た人に、最終的に何をしてほしいか",
    placeholder: "例: 公式LINEに登録してもらう。主催しているイベントに参加してもらう",
    counted: true,
    rows: 2,
  },
  {
    key: "targetPersona",
    column: "target_persona",
    kind: "text",
    section: "sales",
    label: "どんな人に投稿を届けたいか",
    description: "年齢や職業だけでなく、今どんな状況にいる人か。実在しそうな1人を思い浮かべるのがコツです",
    placeholder:
      "例: 28歳前後の会社員。仕事は嫌いではないけれど、30歳が近づいて「このままでいいのかな」と少し焦っている人",
    counted: true,
    rows: 3,
  },
  {
    key: "realWorries",
    column: "real_worries",
    kind: "text",
    section: "sales",
    label: "ターゲットの本音の悩み",
    description: "表向きの悩みではなく、本当は何にモヤモヤしているか",
    placeholder: "例: 会社と家の往復で新しい出会いが減った。SNSで同世代と比べて焦る",
    counted: true,
    rows: 3,
  },
  {
    key: "desiredSelfImage",
    column: "desired_self_image",
    kind: "text",
    section: "sales",
    label: "ターゲットの「なりたい姿」",
    description: "この人がこうなれたら嬉しい、という状態",
    placeholder: "例: 会社以外にも気軽に話せる人がいて、休日の予定に困らない",
    counted: true,
    rows: 3,
  },
  {
    key: "perceivedImage",
    column: "perceived_image",
    kind: "text",
    section: "sales",
    label: "このアカウントがどう見られたいか",
    description: "読者から見て、どんな人だと思われたいか",
    placeholder: "例: 気取らず本音で話してくれる、同世代の人",
    counted: true,
    rows: 2,
  },
  {
    key: "contentThemeMix",
    column: "content_theme_mix",
    kind: "text",
    section: "account",
    label: "発信テーマの掛け合わせ",
    description: "このアカウントが扱うテーマの組み合わせ",
    placeholder: "例: キャリア×日常×人間関係",
    counted: true,
    rows: 2,
  },
  {
    key: "antiPersona",
    column: "anti_persona",
    kind: "text",
    section: "account",
    label: "来てほしくない人",
    description: "ターゲットではない層をはっきりさせる",
    placeholder: "例: 無料の情報だけを消費して終わりたい人",
    counted: true,
    rows: 2,
  },
  {
    key: "benchmarkAccounts",
    column: "benchmark_accounts",
    kind: "text",
    section: "account",
    label: "ベンチマークにしたい他アカウント",
    description: "参考にしたい3アカウント程度と、良いと思う点",
    placeholder: "例: @account_a（共感投稿の言葉選びが上手い）",
    counted: true,
    rows: 2,
  },
  {
    key: "funnelDesign",
    column: "funnel_design",
    kind: "text",
    section: "funnel",
    label: "集客導線の設計",
    description: "表の投稿 → コメント → DM → LINEなど → 成約までの流れ",
    placeholder: "例: 共感投稿でコメントをもらう → 返信で距離を縮める → 興味を持った人にDMでイベントを案内する",
    counted: true,
    rows: 3,
  },
  {
    key: "postGenres",
    column: "post_genres",
    kind: "text",
    section: "funnel",
    label: "投稿ジャンル（3種類程度）",
    description: "このアカウントで扱う投稿のジャンル",
    placeholder: "例: 共感エピソード／知識・気づき／宣伝告知",
    counted: true,
    rows: 2,
  },
  {
    key: "dmReplyTemplate",
    column: "dm_reply_template",
    kind: "text",
    section: "funnel",
    label: "DM返信の型",
    description: "コメントやDMが来たときの返信の基本パターン",
    placeholder: "例: まずお礼 → 状況を軽く聞く → 共感 → 必要なら案内",
    counted: true,
    rows: 2,
  },
  {
    key: "inquiryQualityTips",
    column: "inquiry_quality_tips",
    kind: "text",
    section: "funnel",
    label: "問い合わせの質を上げるコツ",
    description: "本気度の高い人から連絡が来るようにする工夫",
    placeholder: "例: 投稿の中で「誰向けか」をはっきり書く",
    counted: true,
    rows: 2,
  },
  {
    key: "tonePreset",
    column: "tone_preset",
    kind: "select",
    section: "tone",
    label: "近い人間性",
    description: "投稿文の語尾や言葉づかいに反映されます",
    placeholder: "",
    counted: true,
    rows: 1,
  },
  {
    key: "toneNotes",
    column: "tone_notes",
    kind: "text",
    section: "tone",
    label: "その他の文体の条件",
    description: "選択肢にない、追加したい文体の条件",
    placeholder: "例: 「！」は1投稿に1回まで。絵文字は使わない",
    counted: true,
    rows: 2,
  },
  {
    key: "differentiation",
    column: "differentiation",
    kind: "text",
    section: "other",
    label: "競合・他アカウントとの違い",
    description: "同じジャンルの他の人と何が違うか",
    placeholder: "例: 情報発信だけでなく、実際に会えるコミュニティを主催している",
    counted: true,
    rows: 2,
  },
  {
    key: "successMetrics",
    column: "success_metrics",
    kind: "text",
    section: "other",
    label: "成功の指標（KPI）",
    description: "何を見て「うまくいっている」と判断するか",
    placeholder: "例: 月間のフォロワー増加数、DMの問い合わせ数、イベントの集客数",
    counted: true,
    rows: 2,
  },
  {
    key: "profileBioDraft",
    column: "profile_bio_draft",
    kind: "text",
    section: "drafts",
    label: "プロフィール文",
    description: "今のプロフィール文や、考え中の案",
    placeholder: "例: AI×コミュニティ運営｜東京で交流会を主催…",
    counted: false,
    rows: 3,
  },
  ...([1, 2, 3] as const).map(
    (n): StrategyField => ({
      key: `pinnedPostDraft${n}`,
      column: `pinned_post_draft_${n}`,
      kind: "text",
      section: "drafts",
      label: `固定投稿${"①②③"[n - 1]}`,
      description: "今固定している投稿や、固定したい投稿の案",
      placeholder: "例: はじめまして、たくみです。…",
      counted: false,
      rows: 3,
    }),
  ),
];

/** 入力済み項目数の分母（課題①〜③・人柄・その他の16項目）。 */
export const STRATEGY_TOTAL = 16;

/**
 * 項目のキーから、項目の定義を引く。
 * @param key - 項目のキー
 * @returns 項目の定義
 */
export function strategyFieldOf(key: StrategyField["key"]): StrategyField {
  const f = STRATEGY_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`unknown strategy field: ${key}`);
  return f;
}

/**
 * 全項目が空の課題を作る。
 * @returns テキストは ""、近い人間性は null の値
 */
export function emptyStrategyValues(): StrategyValues {
  const values = Object.fromEntries(STRATEGY_TEXT_KEYS.map((k) => [k, ""])) as Record<StrategyTextKey, string>;
  return { ...values, tonePreset: null };
}

/**
 * 入力済み項目数を数える（FR-005）。下書き4項目は数えず、空白だけの値は未入力とする。
 * @param values - 課題の値
 * @returns 16項目のうち入力済みの数
 */
export function countFilled(values: StrategyValues): number {
  return STRATEGY_FIELDS.filter((f) => {
    if (!f.counted) return false;
    if (f.key === "tonePreset") return values.tonePreset !== null;
    return !isBlank(values[f.key]);
  }).length;
}

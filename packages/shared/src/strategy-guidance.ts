// 課題の入力の手助け：考えるヒントと自動チェック（specs/014-strategy-guidance research.md R1・R2）。
// 文言は contracts/hints.md のとおり。課題の画面・深掘りのプロンプト・「投稿をつくる」の情報の一覧が同じ定数を使う（FR-005）。
import { STRATEGY_FIELDS, STRATEGY_SECTIONS, type StrategyField, type StrategySectionId, type StrategyValues } from "./strategy";
import { countChars, isBlank } from "./text";

/** ヒントを持つ項目のキー（表示の順。目的の5問と、数える16項目）。活動の軸と下書きは持たない。 */
export const HINTED_KEYS = [
  "purposeOrigin",
  "purposeSelf",
  "purposeOthers",
  "purposeFuture",
  "purposeStance",
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
  "tonePreset",
  "toneNotes",
  "differentiation",
  "successMetrics",
] as const satisfies readonly StrategyField["key"][];

/** ヒントを持つ項目のキー。 */
export type HintedKey = (typeof HINTED_KEYS)[number];

/** 1項目の考えるヒント。 */
export type StrategyHint = {
  /** コツ */
  tip: string;
  /** 悪い例 */
  bad: string;
  /** 良い例 */
  good: string;
  /** もっとこんな内容も足してみたら？（2〜3個） */
  more: string[];
  /** こんな場合はどうだろう？ */
  whatIf: string;
  /** もっと良くするなら、ここを考えてみて */
  better: string;
  /** 目安の文字数（この文字数以上で「十分」）。選ぶ項目（近い人間性）は null */
  minChars: number | null;
  /** 短めのときの一言。なければ共通の SHORT_TIP */
  shortTip?: string;
  /** ★特に大事 */
  star?: boolean;
  /** ★のとき、項目の下にいつも出す考え方の説明 */
  starNote?: string;
};

/** 短めのときの共通の一言（FR-013）。 */
export const SHORT_TIP = "出来事・気持ち・具体的な場面を1つ足すと、ぐっと伝わりやすくなります";

/** 考えるヒント（contracts/hints.md）。例は、同世代の交流会を開く人のアカウントでそろえている。 */
export const STRATEGY_HINTS: Record<HintedKey, StrategyHint> = {
  purposeOrigin: {
    tip: "理由を一言でまとめず、きっかけになった「場面」を思い出して書きます。",
    bad: "人の役に立ちたいから",
    good: "上京して3年、平日は会社と家の往復で、休日に誰とも話さない日があった。同じように感じている人と出会える場所がほしかった",
    more: ["そのとき、具体的に何に困っていたか", "始める前に迷ったこと"],
    whatIf: "もし今この活動をやめたら、何がいちばん残念ですか？",
    better: "そのきっかけを、初対面の人に30秒で話すならどう話しますか？",
    minChars: 30,
  },
  purposeSelf: {
    tip: "「成功したい」ではなく、どんな場面でどう感じていたいかを書きます。",
    bad: "成功したい",
    good: "「あの人に聞けば誰か紹介してくれる」と頼られ、自分にも毎週会いたい人がいる状態",
    more: ["1年後に、周りからどう言われていたいか", "今の自分に足りないと感じていること"],
    whatIf: "お金の心配がなくても、この活動を続けますか？",
    better: "その姿に近づいたと、何を見たらわかりますか？",
    minChars: 30,
  },
  purposeOthers: {
    tip: "関わった人の「前」と「後」の違いを書きます。",
    bad: "幸せになってほしい",
    good: "休日の予定に困らなくなり、「ここに来てよかった」と次は友達を連れてきてくれる",
    more: ["関わる前、その人はどんな状態か", "関わった後、その人の口ぐせがどう変わるか"],
    whatIf: "あなたの活動から卒業していく人がいたら、どうなっていてほしいですか？",
    better: "実際に変わった人がいれば、その人の話を1つ書いてみましょう",
    minChars: 30,
  },
  purposeFuture: {
    tip: "数年先に、街や業界や人の関係がどう変わっているかを想像します。",
    bad: "みんなが笑顔の世界",
    good: "上京したばかりの人でも、1か月以内に話せる仲間が見つかるのが当たり前の東京",
    more: ["今の世の中で、変わってほしいと思うこと", "その未来で、あなたはどんな役割か"],
    whatIf: "10年後にこの活動が大きくなっていたら、何が変わっていますか？",
    better: "その未来を、一言の合言葉にするなら？",
    minChars: 30,
  },
  purposeStance: {
    tip: "「やらないこと」から考えると書きやすくなります。",
    bad: "誠実でいる",
    good: "無理に誘わない。来た人を一人にしない。うまくいかなかった話も隠さない",
    more: ["発信で絶対にしないこと", "人と関わるときに気をつけていること"],
    whatIf: "売上と在り方がぶつかったら、どちらを取りますか？",
    better: "その在り方が表れた、最近の出来事はありますか？",
    minChars: 30,
  },
  finalAction: {
    tip: "行動は1つに絞り、「どこで」「何をする」まで書きます。",
    bad: "ファンになってほしい",
    good: "公式LINEに登録して、月1回の交流会に参加してもらう",
    more: ["その行動の、ひとつ手前の小さな行動", "行動した人に最初に届けるもの"],
    whatIf: "今すぐは行動しない人には、何をしてもらえば十分ですか？",
    better: "その行動を取った人に、次にしてほしいことは何ですか？",
    minChars: 20,
  },
  targetPersona: {
    tip: "年齢・職業で終わらせず、「今どんな状況で、何にモヤモヤしているか」まで書きます。実在しそうな1人を思い浮かべます。",
    bad: "20代会社員",
    good: "28歳前後の会社員。仕事は嫌いではないけれど、30歳が近づいてきて、このままでいいのかなと少し焦っている人",
    more: ["平日の終わり方と、休日の過ごし方", "よく見ているSNSやアカウント", "お金と時間の余裕"],
    whatIf: "その人が夜にスマホを開いたとき、最初に検索しそうな言葉は何ですか？",
    better: "その人が投稿に「わかる」とコメントするのは、どんな一文を読んだときですか？",
    minChars: 40,
  },
  realWorries: {
    tip: "人に言える悩みの「奥」にある気持ちを書きます。",
    bad: "将来が不安",
    good: "会社と家の往復で新しい出会いが減り、SNSで同世代の結婚や転職の報告を見るたびに、自分だけ止まっている気がして焦る",
    more: ["その悩みを感じる、具体的な曜日や時間", "誰にも言っていない本音"],
    whatIf: "その悩みが解決しないまま1年たったら、どうなっていそうですか？",
    better: "その人が友達にこぼすとき、どんな言葉を使いますか？",
    minChars: 30,
  },
  desiredSelfImage: {
    tip: "本音の悩みの「反対側」を、具体的な場面で書きます。",
    bad: "充実した毎日",
    good: "金曜の夜に「明日どうする？」と連絡できる友達が何人かいて、休日の予定に困らない",
    more: ["なりたい姿になった日の、朝の気分", "周りから言われたい一言"],
    whatIf: "なりたい姿に近い人が身近にいるとしたら、どんな人ですか？",
    better: "なりたい姿への「最初の一歩」は何ですか？",
    minChars: 30,
  },
  perceivedImage: {
    tip: "「すごい人」より、ターゲットが話しかけやすい距離感を考えます。",
    bad: "信頼できる人",
    good: "気取らず本音で話してくれる、少し先を歩いている同世代の人",
    more: ["見られたくない印象", "読者があなたを人に紹介するときの一言"],
    whatIf: "初めて投稿を見た人が、3秒で受け取る印象は何ですか？",
    better: "その見られ方に合う口ぐせや言い回しはありますか？",
    minChars: 20,
  },
  contentThemeMix: {
    tip: "1つは「売りたいもの」、もう1つは「ターゲットが毎日気にしていること」から選びます。",
    bad: "交流会",
    good: "交流会 × 20代後半の休日 × 社会人の友達づくり",
    more: ["ターゲットが最近よく話題にしていること", "あなたが人より詳しい、売りものと関係ない分野"],
    whatIf: "掛け合わせの片方だけで投稿したら、どんな人が集まりそうですか？",
    better: "掛け合わせの候補を3つ出して、いちばん「自分らしい」ものを選んでみましょう",
    minChars: 10,
    star: true,
    starNote:
      "「売りたいもの」だけを発信しても、ターゲットには届きにくいものです。「売りたいもの × ターゲットが共感するテーマ」を掛け合わせます。例：保険の営業の人なら「保険」×「子育て」。子育ての悩みに共感する投稿で人を集め、その中で保険の話をします。",
  },
  antiPersona: {
    tip: "避けたい人を書くと、ターゲットがはっきりします。悪口ではなく「合わない理由」で書きます。",
    bad: "変な人",
    good: "人脈づくりや勧誘だけが目的の人。参加者を「お客さん」として見る人",
    more: ["その人が来ると、ほかの人にどんな影響があるか", "投稿のどんな言葉がその人を呼びそうか"],
    whatIf: "その人が投稿にコメントしてきたら、どう返しますか？",
    better: "来てほしくない人が「来なくなる」一文を、プロフィールに入れるなら？",
    minChars: 20,
  },
  benchmarkAccounts: {
    tip: "アカウント名だけでなく、「どこを参考にしたいか」を1つずつ書きます。",
    bad: "@account_a",
    good: "@account_a（共感投稿の書き出しが上手い）、@account_b（イベントの告知が押し売りにならない）",
    more: ["真似したくない点", "自分と同じくらいの規模のアカウント"],
    whatIf: "そのアカウントがあなたのテーマで投稿したら、どう書きそうですか？",
    better: "リサーチの画面に、そのアカウントの伸びた投稿を登録してみましょう",
    minChars: 15,
  },
  funnelDesign: {
    tip: "「投稿を見る → 何をする → 何をする → 最終的な行動」の順に、矢印でつないで書きます。",
    bad: "投稿で集客する",
    good: "共感の投稿でコメントをもらう → 返信で距離を縮める → 気になった人にプロフィールの公式LINEを見てもらう → 交流会を案内する",
    more: ["それぞれの段階で、人が止まりやすい所", "プロフィールや固定投稿の役割"],
    whatIf: "初めて見た人が、1週間で最終的な行動までたどり着くには？",
    better: "いちばん人が減っている段階を、1つだけ直すならどこですか？",
    minChars: 30,
  },
  postGenres: {
    tip: "3種類くらいに絞り、割合があれば添えます。",
    bad: "いろいろ",
    good: "同世代のあるある（5割）／交流会の様子（3割）／イベントの案内（2割）",
    more: ["ジャンルごとの狙い（共感・信頼・行動）", "続けやすさ"],
    whatIf: "1か月、1つのジャンルしか投稿できないとしたら、どれを選びますか？",
    better: "伸びた投稿は、どのジャンルでしたか？",
    minChars: 10,
  },
  dmReplyTemplate: {
    tip: "返信の順番を、矢印でつないで書きます。",
    bad: "丁寧に返す",
    good: "まずお礼 → 状況を軽く聞く → 共感する → 必要なら交流会を案内する（無理に誘わない）",
    more: ["返信までの時間の目安", "案内しないほうがいい場合"],
    whatIf: "相談が長くなりそうなときは、どう返しますか？",
    better: "最初の一文の例を、1つ書いてみましょう",
    minChars: 20,
  },
  inquiryQualityTips: {
    tip: "本気度の高い人から連絡が来るように、投稿やプロフィールで伝えておくことを書きます。",
    bad: "わかりやすく書く",
    good: "投稿の中で「誰向けか」をはっきり書く。参加の条件や費用を先に書いておく",
    more: ["よく来る、合わない問い合わせの例", "先に答えておくとよい質問"],
    whatIf: "冷やかしの問い合わせが続いたら、どこを直しますか？",
    better: "問い合わせの前に読んでほしい投稿を、固定投稿にしてみましょう",
    minChars: 20,
  },
  tonePreset: {
    tip: "普段の話し方にいちばん近いものを選びます。迷ったら、読んでほしい人に合わせます。",
    bad: "（選んだだけで、その他の文体の条件が空のまま）",
    good: "「丁寧・温かい」を選び、その他の文体の条件に「語尾は『〜だよね』まで。絵文字は1つまで」と足す",
    more: ["よく使う口ぐせ", "使わない言葉"],
    whatIf: "友達に送るLINEと、投稿の話し方は同じですか？",
    better: "自分の過去の投稿で「自分らしい」と思う1つを、文体の条件に書き写してみましょう",
    minChars: null,
  },
  toneNotes: {
    tip: "語尾・絵文字・記号・改行など、決めていることを箇条書きにします。",
    bad: "自然に",
    good: "「！」は1投稿に1回まで。絵文字は使わない。1〜2文ごとに改行する",
    more: ["使わない言葉", "一人称（私・僕・自分など）"],
    whatIf: "宣伝の投稿でも、同じ話し方にしますか？",
    better: "「こう書かれたら自分らしくない」例を1つ書いてみましょう",
    minChars: 15,
  },
  differentiation: {
    tip: "同じジャンルの人と比べて、「自分にしかない経験・やり方」を書きます。",
    bad: "熱意がある",
    good: "情報を発信するだけでなく、実際に会える交流会を毎月開いている。初参加の人の9割が一人で来る",
    more: ["選ばれた理由として言われたこと", "続けてきた年数・回数"],
    whatIf: "同じ交流会が近くにできたら、何で選んでもらいますか？",
    better: "その違いが伝わる投稿を、1つ思い浮かべてみましょう",
    minChars: 20,
  },
  successMetrics: {
    tip: "見る数字と、いつまでにどれくらいかを書きます。",
    bad: "フォロワーを増やす",
    good: "3か月で、公式LINEの登録を月20人。交流会の初参加を月5人",
    more: ["毎週見る数字と、毎月見る数字", "数字が届かなかったときに見直すこと"],
    whatIf: "フォロワーは増えたのに問い合わせが増えないときは、何を見ますか？",
    better: "最終的な行動（営業導線設計）につながる数字を1つ選んでみましょう",
    minChars: 10,
  },
};

/**
 * 項目のヒントを返す。ヒントを持たない項目（活動の軸・下書き）は null。
 * @param key - 項目のキー
 * @returns ヒント
 */
export function hintOf(key: StrategyField["key"]): StrategyHint | null {
  return (STRATEGY_HINTS as Partial<Record<StrategyField["key"], StrategyHint>>)[key] ?? null;
}

/** 自動チェックの判定（FR-010）。 */
export type CheckStatus = "empty" | "short" | "ok";

/** 自動チェックの結果（research.md R2）。 */
export type StrategyCheck = {
  /** 項目ごとの判定と文字数（前後の空白を除く） */
  items: Record<HintedKey, { status: CheckStatus; chars: number }>;
  /** 数える16項目のうち「十分」の数 */
  done: number;
  /** 数える16項目と目的の5問のうち「短め」の数 */
  review: number;
  /** 目的の5問のうち「十分」の数 */
  purposeDone: number;
  /** 次におすすめの項目。すべて十分なら null */
  next: HintedKey | null;
  /** 区分ごとの「十分」の数と項目数。下書きは null */
  sections: Record<StrategySectionId, { done: number; total: number } | null>;
};

const PURPOSE_HINTED = new Set<HintedKey>(["purposeOrigin", "purposeSelf", "purposeOthers", "purposeFuture", "purposeStance"]);

/**
 * 課題の自動チェック（FR-010〜FR-016）。入力の量だけを見て、内容の良し悪しは判定しない。
 * 下書きの4項目と活動の軸は判定しない。
 * @param values - 課題の値（未保存を含む）
 * @returns 項目ごとの判定・数・次におすすめ・区分ごとの数
 */
export function checkStrategy(values: StrategyValues): StrategyCheck {
  const items = {} as StrategyCheck["items"];
  for (const key of HINTED_KEYS) {
    if (key === "tonePreset") {
      items[key] = { status: values.tonePreset === null ? "empty" : "ok", chars: 0 };
      continue;
    }
    const text = values[key];
    const chars = isBlank(text) ? 0 : countChars(text.trim());
    const min = STRATEGY_HINTS[key].minChars ?? 1;
    items[key] = { status: chars === 0 ? "empty" : chars < min ? "short" : "ok", chars };
  }
  let done = 0;
  let review = 0;
  let purposeDone = 0;
  for (const key of HINTED_KEYS) {
    const { status } = items[key];
    if (status === "short") review += 1;
    if (status === "ok") {
      if (PURPOSE_HINTED.has(key)) purposeDone += 1;
      else done += 1;
    }
  }
  const next = HINTED_KEYS.find((k) => items[k].status === "empty") ?? HINTED_KEYS.find((k) => items[k].status === "short") ?? null;
  const sections = {} as StrategyCheck["sections"];
  for (const section of STRATEGY_SECTIONS) {
    const keys = STRATEGY_FIELDS.filter((f) => f.section === section.id && f.key in items).map((f) => f.key as HintedKey);
    sections[section.id] =
      keys.length === 0 ? null : { done: keys.filter((k) => items[k].status === "ok").length, total: keys.length };
  }
  return { items, done, review, purposeDone, next, sections };
}

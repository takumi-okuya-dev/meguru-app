// 外部LLMに送るプロンプトの組み立て（specs/003-prompt-bulk-register contracts/prompt-template.md、research.md R1・R2・R12）。
// 文面の土台は参考プロダクトのプロンプト（reference-prompt.md）。004の却下された投稿・006の改善フィードバックの節は、ここに足す。
import { PROMPT_LENGTH_TARGET, PROMPT_RECENT_DRAFTS, PROMPT_REFERENCE_POSTS } from "./limits";
import type { PromptSummary } from "./schemas";
import { countFilled, TONE_PRESETS, type StrategyValues } from "./strategy";
import { isBlank } from "./text";

/** プロンプトに含める宣伝内容（宣伝の対象だけ。掲載期限の近い順、期限なしは最後、同じなら優先度の高い順）。 */
export type PromptPromotion = {
  content: string;
  targetLocation: string;
  targetPersona: string;
  targetAgeRange: string;
  cta: string;
  linkedUrl: string | null;
};

/** プロンプトに含める参考投稿。 */
export type PromptReferencePost = { body: string; keyword: string; whyGood: string };

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
  /** 投稿ストックの直近の下書きの本文。新しい順。先頭の PROMPT_RECENT_DRAFTS 件まで使う */
  recentDrafts: string[];
};

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

function strategySection(strategy: StrategyValues): string | null {
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
  return ["■アカウントの戦略設計(設定済みの項目。方向性として必ず踏まえること)", ...lines].join("\n");
}

function promotionLine(p: PromptPromotion, i: number): string {
  const target = [
    ["場所", p.targetLocation],
    ["どんな人", p.targetPersona],
    ["年齢", p.targetAgeRange],
  ]
    .filter(([, v]) => !isBlank(v!))
    .map(([k, v]) => `${k}: ${v}`);
  let line = `${i + 1}. ${p.content}`;
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
  if (n === 2) return ["掲載期限が近い順に並んでいます。期限が近いものはやや多めに扱ってよいが、2件ともきちんと扱うこと。"];
  return [];
}

function promotionSection(count: number, ratio: number, promotions: PromptPromotion[]): string {
  const share = Math.max(1, Math.round((count * ratio) / 100));
  return [
    `■今回組み込む宣伝内容(宣伝投稿の割合は${ratio}%の設定です。今回生成する${count}件のうち${share}件程度に自然に絡めること。残りは宣伝色のない共感・気づき系の投稿にすること)`,
    ...promotionGuidance(promotions.length),
    ...promotions.map(promotionLine),
    "",
    "宣伝を含む投稿でも、押し売り・広告っぽい言い回しにはせず、トーンをそのまま守ること。「届けたい相手」に書かれた属性を意識した切り口にすること。",
  ].join("\n");
}

function researchSection(count: number, posts: PromptReferencePost[]): string {
  const items = posts.map((p, i) => {
    const keyword = isBlank(p.keyword) ? "" : `[検索語:${p.keyword}] `;
    const why = isBlank(p.whyGood) ? "(未記入。投稿の構成から型を読み取ること)" : p.whyGood;
    return `${i + 1}. ${keyword}元の投稿(参考: 内容はコピーしない): ${p.body}\n   なぜ良いか: ${why}`;
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
    `手順4: ${count}件のうち、最低でも${Math.min(3, count)}件はこの手順で明確に「型」を踏襲した投稿にすること。どの型を使ったかが分かるように、フック文の作り方に反映させること。`,
    "",
    ...items,
  ].join("\n");
}

function dedupeSection(count: number, drafts: string[]): string {
  const lines = [
    "■重複防止(絶対厳守。最も重要なルールの1つ)",
    `- ${count}件それぞれ、言いたい核(結論・メッセージ)を1行で要約したときに、他のどれとも被らないこと。書き出しや言い回しを変えただけの「実質同じ投稿」は禁止。`,
    `- 上に書かれている宣伝内容・リサーチ内容${drafts.length > 0 ? "、下に並べた投稿ストックの下書き" : ""}とも、核となる話題やエピソードが重複しないこと。同じテーマを扱う場合も、切り口・具体例・結論を変えて別物にすること。`,
    `- 生成の最後に、${count}件同士を見比べて「言いたいことが似すぎているペア」が無いか自分で確認し、あれば書き直してから出力すること。`,
  ];
  if (drafts.length > 0) {
    lines.push("", "投稿ストックにある直近の下書き(これらと核が被らないこと):", ...drafts.map((d, i) => `${i + 1}. ${d}`));
  }
  return lines.join("\n");
}

function lengthMixSection(count: number): string {
  return [
    "■短文・中文・長文は「長さ」だけでなく「役割」も変える(必ず守ること)",
    `${count}件の中に、次の3タイプをバランス良く混ぜること(目安比率: 短文3〜4割・中文4〜5割・長文2〜3割)。同じ役割の投稿を3件以上連続させないこと。`,
    "いずれのタイプも、下の「■文字数について」の目安(150文字)を必ず守ること。「長文」は文字数を増やすのではなく、改行の使い方・構成で「長さ・重み」を感じさせること。",
    "- 短文(1〜2文、40〜70文字前後): 説明せず言い切るタイプ。一撃で「わかる」「それな」と思わせる一言・あるある・問いかけだけで完結させる。背景説明やオチの解説はつけない。",
    "- 中文(3〜5文、80〜120文字前後): 「気づき→展開→軽い着地」の小さな流れを作る。最初の一文で状況や違和感を提示し、そこから思ったことを1段展開し、最後に前向きな一言か問いかけで締める。",
    "- 長文(改行多め、120〜150文字前後): 「状況→心境の変化→今どう思っているか」のミニストーリー構成を、短い文を細かく改行で区切ることで作る。文字数自体は中文とあまり変えず、行間の余白・テンポで「読ませる長さ」を演出する。説明的にならず、実体験を話しているような温度感にする。",
    `- 冒頭の切り口(フック)も毎回変えること。例: 断言から始める/問いかけから始める/具体的な場面描写から始める/数字から始める/「〜な人へ」という呼びかけから始める/意外性のある一言から始める/エピソードの結末から先に言う、など。同じフックのパターンを${count}件のうち3件以上連続で使わないこと。`,
  ].join("\n");
}

function charCountSection(count: number): string {
  return [
    "■文字数について(必ず守ること)",
    "Threadsの1投稿の上限は500文字で、絵文字だけは1文字ではなくUTF-8のバイト数(多くは4)で数えられる。上限を超えると投稿できない。",
    "- 改行・絵文字・記号もすべて含めた本文全体を、150文字以内におさめること(130文字前後を目標にし、余裕を持って短くすること)。",
    "- 絵文字は1投稿につき合計3個までにすること。",
    "- リンク(URL)は1投稿につき5個までにすること。",
    `- 生成の最後に、${count}件それぞれの本文を改行・絵文字含めて数え、150文字を超えているものが無いか自分で確認し、超えていれば必ず削って出力すること。`,
  ].join("\n");
}

function outputSection(count: number): string {
  return [
    "■出力形式(必ず守ること。最後の1件まで絶対に崩さないこと。今回最も間違えやすいルールなので特に注意すること)",
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
    `生成できたら、この出力をまるごとコピーして、ThreadsGrowerの投稿ストックの画面にある貼り付け欄に1回で貼り付けてください。"@@@"の行で自動的に${count}件に分割して登録されます(1件ずつコピーし直す必要はありません)。`,
  ].join("\n");
}

function assemble(input: PromptInput, posts: PromptReferencePost[], drafts: string[], withPromotions: boolean): string {
  const { count } = input;
  const sections = [
    `以下の情報をもとに、Threadsに投稿する文章を${count}件作ってください。`,
    `■話者\n表示名: ${input.displayName}`,
    strategySection(input.strategy),
    withPromotions ? promotionSection(count, input.promotionRatioPercent, input.promotions) : null,
    posts.length > 0 ? researchSection(count, posts) : null,
    dedupeSection(count, drafts),
    lengthMixSection(count),
    charCountSection(count),
    outputSection(count),
  ];
  return sections.filter((s): s is string => s !== null).join("\n\n");
}

/**
 * 戦略プロファイルと投稿ストックから、外部LLMに送るプロンプトを組み立てる（FR-002・FR-003・FR-008）。
 * 全文が PROMPT_LENGTH_TARGET 文字を超えるときは、直近の下書き → 参考投稿の順に、古いものから減らして収める（R12）。
 * @param input - 材料
 * @returns 全文と、実際に含めた材料の数
 */
export function buildPrompt(input: PromptInput): { prompt: string; summary: PromptSummary } {
  const withPromotions = input.promotions.length > 0 && input.promotionRatioPercent >= 1;
  let posts = input.referencePosts.slice(0, PROMPT_REFERENCE_POSTS);
  let drafts = input.recentDrafts.slice(0, PROMPT_RECENT_DRAFTS);
  let prompt = assemble(input, posts, drafts, withPromotions);
  let length = [...prompt].length;
  while (length > PROMPT_LENGTH_TARGET && (drafts.length > 0 || posts.length > 0)) {
    if (drafts.length > 0) drafts = drafts.slice(0, -1);
    else posts = posts.slice(0, -1);
    prompt = assemble(input, posts, drafts, withPromotions);
    length = [...prompt].length;
  }
  return {
    prompt,
    summary: {
      strategyFilledCount: countFilled(input.strategy),
      promotionCount: withPromotions ? input.promotions.length : 0,
      referencePostCount: posts.length,
      recentDraftCount: drafts.length,
      length,
    },
  };
}

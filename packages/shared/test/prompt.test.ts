import { describe, expect, it } from "vitest";
import { POLICY_PROMPT_RULES } from "../src/policy";
import { buildPrompt, splitLengthMix, type PromptInput } from "../src/prompt";
import { emptyStrategyValues } from "../src/strategy";

function input(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    count: 30,
    displayName: "たくみ",
    strategy: emptyStrategyValues(),
    promotions: [],
    promotionRatioPercent: 20,
    referencePosts: [],
    recentDrafts: [],
    coreRules: [],
    ngWords: [],
    rejectedDrafts: [],
    ...overrides,
  };
}

const FIDELITY =
  "ここに書かれているのは、本人が決めた方針です。要約したり一部だけ使ったりせず、言葉づかい・禁止事項・例文・箇条書きのニュアンスまで忠実に反映すること。「来てほしくない人」やCORE RULESと食い違う内容は書かないこと。文体・人柄の指定が、下の共通ルール(語尾・改行など)と食い違うときは、文体・人柄を優先する(ただし、文字数・区切り「@@@」・NGワード・CORE RULESは必ず守る)。";

const promo = (content: string, extra: Partial<PromptInput["promotions"][number]> = {}) => ({
  title: "",
  validUntil: null,
  content,
  targetLocation: "",
  targetPersona: "",
  targetAgeRange: "",
  cta: "",
  linkedUrl: null,
  ...extra,
});

describe("buildPrompt（contracts/prompt-template.md）", () => {
  it("導入・話者・重複防止・短文中文長文・文字数・出力形式は常に含む", () => {
    const { prompt } = buildPrompt(input({ count: 10 }));
    expect(prompt.startsWith("以下の情報をもとに、Threadsに投稿する文章を10件作ってください。\n\n【最初に確認すること(最重要)】")).toBe(true);
    expect(prompt).toContain("\n\n■話者\n表示名: たくみ");
    expect(prompt).toContain("■重複防止(絶対厳守。最も重要なルールの1つ)");
    expect(prompt).toContain("■短文・中文・長文は「長さ」だけでなく「役割」も変える(必ず守ること)\n10件の内訳: 短文4件・中文4件・長文2件");
    expect(prompt).toContain("下の「■文字数について」の目安(150文字以内)");
    expect(prompt).toContain("Threadsの1投稿の上限は500文字で、絵文字だけは1文字ではなくUTF-8のバイト数(多くは4)で数えられる。");
    expect(prompt).not.toContain("500バイト");
    expect(prompt).toContain("10件なら区切り線はちょうど9個になる。出力の最後に区切り線の数を自分で数え、9個になっているか");
    expect(prompt).toContain("事実は上記に書かれているものだけを使う。");
    expect(prompt).toContain("ThreadsGrowerの「投稿をつくる」の画面にある貼り付け欄に1回で貼り付けてください。\"@@@\"の行で自動的に10件に分割して登録されます(1件ずつコピーし直す必要はありません)。");
    expect(prompt.indexOf("■出力形式")).toBeLessThan(prompt.indexOf("■出力する前の最終チェック"));
    expect(prompt).not.toContain("{");
  });

  it("入力済みの課題の項目だけを、決まった見出しで含める。下書き（プロフィール・固定投稿）は戦略設計の節に入れない", () => {
    const strategy = {
      ...emptyStrategyValues(),
      targetPersona: "28歳の会社員\n少し焦っている",
      realWorries: "   ",
      tonePreset: "polite_warm" as const,
      successMetrics: "DMの数",
      profileBioDraft: "プロフィールの下書き",
      pinnedPostDraft1: "固定投稿の下書き",
    };
    const { prompt, summary } = buildPrompt(input({ strategy }));
    expect(prompt).toContain(
      `■アカウントの戦略設計(設定済みの項目。方向性として必ず踏まえること)\n${FIDELITY}\nターゲット: 28歳の会社員\n少し焦っている\n人柄(近い人間性): 丁寧・温かい\n成功の指標: DMの数\n\n`,
    );
    expect(prompt).not.toContain("ターゲットの本音の悩み");
    expect(prompt).not.toContain("成功の指標: DMの数\nプロフィール");
    expect(summary.strategyFilledCount).toBe(3);
  });

  it("材料のない節は見出しごと省く", () => {
    const { prompt, summary } = buildPrompt(input());
    expect(prompt).not.toContain("■アカウントの戦略設計");
    expect(prompt).not.toContain("■今回組み込む宣伝内容");
    expect(prompt).not.toContain("■リサーチで見つけた");
    expect(prompt).not.toContain("投稿ストックにある直近の下書き");
    expect(prompt).not.toContain("■活動の目的・在り方");
    expect(prompt).not.toContain("■現在のプロフィールと固定投稿");
    expect(prompt).not.toContain("【話題の配分");
    expect(prompt).not.toContain("【宣伝投稿の書き方");
    expect(prompt).toContain("- 上に書かれている宣伝内容・リサーチ内容とも、核となる話題");
    expect(summary).toMatchObject({ strategyFilledCount: 0, promotionCount: 0, referencePostCount: 0, recentDraftCount: 0 });
  });

  it("宣伝投稿の件数：件数30・割合20%でちょうど6件、件数3・割合10%でちょうど1件", () => {
    const promotions = [promo("交流会のご案内")];
    expect(buildPrompt(input({ promotions })).prompt).toContain(
      "■今回組み込む宣伝内容(30件のうち、宣伝投稿はちょうど6件。残りの24件は宣伝の行動喚起を入れない通常投稿にすること)",
    );
    expect(buildPrompt(input({ count: 3, promotionRatioPercent: 10, promotions })).prompt).toContain(
      "(3件のうち、宣伝投稿はちょうど1件。残りの2件は",
    );
  });

  it("宣伝の対象が3件以上のときだけ、偏らせない指示を出す。1件なら並び順・偏りの指示を出さない（Codexレビュー）", () => {
    const three = buildPrompt(input({ promotions: [promo("A"), promo("B"), promo("C")] })).prompt;
    expect(three).toContain(
      "掲載期限が近い順に並んでいます。期限が近いものはやや多めに扱ってよいが、一部だけに偏らせないこと。期限未設定のものも含め、下に掲載している宣伝内容全体をきちんと扱うこと。\n下に3件掲載している宣伝内容のうち、特定の1〜2件だけに偏らせないこと。\n同じ宣伝内容を続けて扱わないこと。\n1. (期限なし) A",
    );
    const one = buildPrompt(input({ promotions: [promo("A")] })).prompt;
    expect(one).toContain("通常投稿にすること)\n同じ宣伝内容を続けて扱わないこと。\n1. (期限なし) A\n");
    expect(one).not.toContain("偏らせない");
    expect(one).not.toContain("掲載期限が近い順");
  });

  it("割合0%なら宣伝の節を省き、要約の件数も0", () => {
    const { prompt, summary } = buildPrompt(input({ promotionRatioPercent: 0, promotions: [promo("A")] }));
    expect(prompt).not.toContain("■今回組み込む宣伝内容");
    expect(summary.promotionCount).toBe(0);
  });

  it("宣伝の行：入力済みの届けたい属性・CTA・専用URLだけを並べる", () => {
    const { prompt, summary } = buildPrompt(
      input({
        promotions: [
          promo("交流会", { targetLocation: "東京", targetAgeRange: "20代", cta: "DMで申し込み", linkedUrl: "https://example.com/e" }),
          promo("相談会"),
        ],
      }),
    );
    expect(prompt).toContain("掲載期限が近い順に並んでいます。期限が近いものはやや多めに扱ってよいが、2件ともきちんと扱うこと。\n同じ宣伝内容を続けて扱わないこと。\n1. (期限なし) 交流会");
    expect(prompt).not.toContain("偏らせない");
    expect(prompt).toContain("1. (期限なし) 交流会(届けたい相手: 場所: 東京 / 年齢: 20代) / 行動喚起: DMで申し込み / 専用URL: https://example.com/e\n2. (期限なし) 相談会\n");
    expect(summary.promotionCount).toBe(2);
  });

  it("参考投稿は渡した順に10件まで。検索語・なぜ良いかの有無で書き分け、型を使う件数は作る件数まで", () => {
    const referencePosts = Array.from({ length: 12 }, (_, i) => ({ body: `参考${i}`, keyword: i === 0 ? "転職" : "", whyGood: i === 0 ? "数字から入る" : "" }));
    const { prompt, summary } = buildPrompt(input({ count: 2, referencePosts }));
    expect(prompt).toContain("1. 元の投稿(参考: 内容はコピーしない) [検索語:転職]\n   > 参考0\n   なぜ良いか: 数字から入る\n");
    expect(prompt).toContain("2. 元の投稿(参考: 内容はコピーしない)\n   > 参考1\n   なぜ良いか: (分析メモなし。フック・構成・感情の動かし方を自分で読み取ること)");
    expect(prompt).toContain("参考9");
    expect(prompt).not.toContain("参考10");
    expect(prompt).toContain("手順4: 2件のうち、最低でも2件はこの手順で");
    expect(summary.referencePostCount).toBe(10);
  });

  it("下書きは新しい順に20件まで並べ、重複防止の文に下書きを足す", () => {
    const recentDrafts = Array.from({ length: 25 }, (_, i) => `下書き${i}`);
    const { prompt, summary } = buildPrompt(input({ recentDrafts }));
    expect(prompt).toContain("- 上に書かれている宣伝内容・リサーチ内容、下に並べた投稿ストックの下書きとも、核となる話題");
    expect(prompt).toContain("投稿ストックにある直近の下書き(これらと核が被らないこと):\n1. 下書き0\n2. 下書き1\n");
    expect(prompt).toContain("20. 下書き19\n");
    expect(prompt).not.toContain("下書き20");
    expect(summary.recentDraftCount).toBe(20);
  });

  it("30,000文字を超える材料では、下書き → 参考投稿の順に古いものから減らして収める", () => {
    const long = (s: string) => s.repeat(1500);
    const recentDrafts = Array.from({ length: 20 }, (_, i) => long(`d${i % 10}`));
    const referencePosts = Array.from({ length: 10 }, (_, i) => ({ body: long(`r${i}`), keyword: "", whyGood: "" }));
    const { prompt, summary } = buildPrompt(input({ recentDrafts, referencePosts }));
    expect(summary.length).toBeLessThanOrEqual(30000);
    expect(summary.length).toBe([...prompt].length);
    expect(summary.recentDraftCount).toBe(0);
    expect(summary.referencePostCount).toBeGreaterThan(0);
    expect(summary.referencePostCount).toBeLessThan(10);
    // 新しいもの（先頭）から残る
    expect(prompt).toContain(long("r0"));
  });

  it("要約の length は全文のコードポイントの数", () => {
    const { prompt, summary } = buildPrompt(input({ displayName: "😀" }));
    expect(summary.length).toBe([...prompt].length);
  });
});

describe("CORE RULESと却下された投稿（specs/004-review-approval contracts/prompt-template.md）", () => {
  const rejected = (body: string, reasonLabels: string[] = [], note: string | null = null) => ({ body, reasonLabels, note });

  it("材料がなくても「■絶対に守るルール(CORE RULES)」が話者の直後にあり、規約上のルール6つが入る（FR-041、SC-009）", () => {
    const { prompt, summary } = buildPrompt(input());
    const rules = POLICY_PROMPT_RULES.map((r) => `・${r}`).join("\n");
    expect(prompt).toContain(`■話者\n表示名: たくみ\n\n■絶対に守るルール(CORE RULES)\n${rules}\n\n`);
    expect(POLICY_PROMPT_RULES).toHaveLength(6);
    expect(prompt).not.toContain("次の言葉は使わないこと");
    expect(summary).toMatchObject({ coreRuleCount: 0, ngWordCount: 0, rejectedCount: 0 });
  });

  it("規約上のルール → 投稿ルールの行 → NGワードの1行の順。行頭の記号はそのまま残す（FR-022、SC-006）", () => {
    const { prompt, summary } = buildPrompt(
      input({ coreRules: ["断定口調は使わない", "- 医療の効果をうたわない"], ngWords: ["絶対", "必ず儲かる"] }),
    );
    const last = POLICY_PROMPT_RULES.at(-1)!;
    expect(prompt).toContain(
      `・${last}\n・断定口調は使わない\n・- 医療の効果をうたわない\n・次の言葉は使わないこと: 絶対、必ず儲かる\n\n`,
    );
    expect(summary).toMatchObject({ coreRuleCount: 2, ngWordCount: 2 });
  });

  it("宣伝内容の最後の文は「上記のCORE RULES・トーンをそのまま守ること」", () => {
    const { prompt } = buildPrompt(input({ promotions: [promo("体験会")] }));
    expect(prompt).toContain("押し売り・広告っぽい言い回しにはせず、上記のCORE RULES・トーンをそのまま守ること。");
  });

  it("却下の節は宣伝内容の後・リサーチの前。理由は候補だけ・自由記述だけ・両方で書き分ける（FR-023）", () => {
    const { prompt, summary } = buildPrompt(
      input({
        promotions: [promo("体験会")],
        referencePosts: [{ body: "参考", keyword: "", whyGood: "" }],
        rejectedDrafts: [
          rejected("却下A", ["トーンが違う", "内容が薄い"]),
          rejected("却下B", [], "語尾がきつい"),
          rejected("却下C\n2行目", ["トーンが違う"], "語尾がきつい"),
        ],
      }),
    );
    expect(prompt).toContain(
      "■過去に却下された投稿(この傾向は繰り返さないこと)\n" +
        "1. 却下A(却下理由: トーンが違う・内容が薄い)\n" +
        "2. 却下B(却下理由: 語尾がきつい)\n" +
        "3. 却下C\n2行目(却下理由: トーンが違う / 語尾がきつい)",
    );
    const at = (s: string) => prompt.indexOf(s);
    expect(at("■今回組み込む宣伝内容")).toBeLessThan(at("■過去に却下された投稿"));
    expect(at("■過去に却下された投稿")).toBeLessThan(at("■リサーチで見つけた"));
    expect(prompt).toContain("- 上に書かれている却下された投稿・宣伝内容・リサーチ内容とも、");
    expect(summary.rejectedCount).toBe(3);
  });

  it("却下は10件まで。0件なら節がない", () => {
    const many = Array.from({ length: 11 }, (_, i) => rejected(`却下${i}`, ["トーンが違う"]));
    const { prompt, summary } = buildPrompt(input({ rejectedDrafts: many }));
    expect(prompt).toContain("10. 却下9(");
    expect(prompt).not.toContain("却下10");
    expect(summary.rejectedCount).toBe(10);
    expect(buildPrompt(input()).prompt).not.toContain("■過去に却下された投稿");
  });

  it("長さの目安を超えると、直近の下書き → 却下 → 参考投稿の順に減らし、CORE RULESは減らさない", () => {
    const long = (s: string) => s.repeat(1500);
    const { prompt, summary } = buildPrompt(
      input({
        recentDrafts: Array.from({ length: 5 }, (_, i) => long(`d${i}`)),
        rejectedDrafts: Array.from({ length: 10 }, (_, i) => rejected(long(`j${i}`), ["トーンが違う"])),
        referencePosts: Array.from({ length: 10 }, (_, i) => ({ body: long(`r${i}`), keyword: "", whyGood: "" })),
        coreRules: ["断定口調は使わない"],
        ngWords: ["絶対"],
      }),
    );
    expect(summary.length).toBeLessThanOrEqual(30000);
    expect(summary.recentDraftCount).toBe(0);
    expect(summary.rejectedCount).toBe(0);
    expect(summary.referencePostCount).toBeGreaterThan(0);
    expect(prompt).toContain("・断定口調は使わない\n・次の言葉は使わないこと: 絶対");
  });
});

describe("005：1日の投稿数で宣伝の件数を伝える", () => {
  it.each([4, 2])("時刻%dつ・割合25パーセントは1日1件程度、生成30件はちょうど8件", (dailyPostCount) => {
    const result = buildPrompt(input({ dailyPostCount, promotionRatioPercent: 25, promotions: [promo("サービス")] }));
    expect(result.prompt).toContain(
      `30件のうち、宣伝投稿はちょうど8件。残りの22件は宣伝の行動喚起を入れない通常投稿にすること)\n宣伝投稿の割合は25%の設定です。1日の投稿は${dailyPostCount}件の設定で、そのうち1件程度が宣伝投稿になります。\n`,
    );
    expect(result.summary.dailyPostCount).toBe(dailyPostCount);
  });
  it("時刻0件は従来の文面を保つ", () => {
    const overrides = { promotionRatioPercent: 25, promotions: [promo("サービス")] };
    expect(buildPrompt(input({ ...overrides, dailyPostCount: 0 })).prompt).toBe(buildPrompt(input(overrides)).prompt);
  });
});

describe("反応が低かった投稿の節（specs/006 contracts/prompt-template.md、FR-025〜FR-027）", () => {
  const HEADING = "■反応が低かった投稿(このアカウントで閲覧数が基準の半分以下だった投稿。同じ書き方・切り口は避けること)";
  const poor = [
    { body: "AI初心者の人ほど、\n完璧を目指さなくていい。", memo: null },
    { body: "AIに文章を書いてもらうとき。", memo: "前置きが長く、結論が最後まで出てこない" },
  ];

  it("却下の節の直後に、本文とメモ付きで入る", () => {
    const { prompt, summary } = buildPrompt(
      input({ rejectedDrafts: [{ body: "却下の本文", reasonLabels: ["抽象的"], note: null }], poorPosts: poor }),
    );
    const rejectedAt = prompt.indexOf("■過去に却下された投稿");
    const poorAt = prompt.indexOf(HEADING);
    expect(rejectedAt).toBeGreaterThan(-1);
    expect(poorAt).toBeGreaterThan(rejectedAt);
    expect(prompt).toContain(
      `${HEADING}\n1. AI初心者の人ほど、\n完璧を目指さなくていい。\n2. AIに文章を書いてもらうとき。(傾向メモ: 前置きが長く、結論が最後まで出てこない)`,
    );
    expect(summary.poorPostCount).toBe(2);
  });

  it("却下が0件でも、宣伝内容の後・リサーチの前に入る", () => {
    const { prompt } = buildPrompt(
      input({ poorPosts: poor, referencePosts: [{ body: "参考", keyword: "", whyGood: "" }] }),
    );
    expect(prompt.indexOf(HEADING)).toBeGreaterThan(-1);
    expect(prompt.indexOf(HEADING)).toBeLessThan(prompt.indexOf("■リサーチで見つけた"));
  });

  it("0件なら節ごと省く", () => {
    const { prompt, summary } = buildPrompt(input({ poorPosts: [] }));
    expect(prompt).not.toContain("■反応が低かった投稿");
    expect(summary.poorPostCount).toBe(0);
    expect(buildPrompt(input()).prompt).not.toContain("■反応が低かった投稿");
  });

  it("長さの調整で、直近の下書き・却下・参考投稿を減らしても、この節は減らさない", () => {
    const long = "あ".repeat(800);
    const { prompt, summary } = buildPrompt(
      input({
        recentDrafts: Array.from({ length: 20 }, () => long),
        rejectedDrafts: Array.from({ length: 10 }, () => ({ body: long, reasonLabels: ["抽象的"], note: null })),
        referencePosts: Array.from({ length: 10 }, () => ({ body: long, keyword: "", whyGood: "" })),
        poorPosts: Array.from({ length: 5 }, (_, i) => ({ body: `低調${i}${long}`, memo: null })),
      }),
    );
    expect(summary.recentDraftCount).toBeLessThan(20);
    expect(summary.poorPostCount).toBe(5);
    for (let i = 0; i < 5; i++) expect(prompt).toContain(`${i + 1}. 低調${i}`);
  });
});

describe("活動の目的・在り方の節（specs/014 FR-053、contracts/prompt-template.md 1-5）", () => {
  it("戦略設計の節のすぐ後に、入力のある答えと活動の軸だけを決まった見出しで入れる", () => {
    const strategy = {
      ...emptyStrategyValues(),
      finalAction: "公式LINEに登録",
      purposeOrigin: "上京して寂しかった",
      purposeStance: "無理に誘わない",
      activityAxis: "ひとりにしない",
    };
    const { prompt } = buildPrompt(input({ strategy }));
    const section =
      "■活動の目的・在り方(本人の言葉。投稿の方向性・判断基準として踏まえ、これと矛盾する内容は書かないこと)\n" +
      "- 活動を始めたきっかけ: 上京して寂しかった\n" +
      "- 大切にしたい在り方・判断基準: 無理に誘わない\n" +
      "- 活動の軸: ひとりにしない";
    expect(prompt).toContain(section);
    expect(prompt.indexOf("■アカウントの戦略設計")).toBeLessThan(prompt.indexOf("■活動の目的・在り方"));
    expect(prompt.indexOf("■活動の目的・在り方")).toBeLessThan(prompt.indexOf("■重複防止"));
    expect(prompt).not.toContain("- 活動を通して自分がなりたい姿:");
  });

  it("課題がほかに空でも、目的があれば節が入る。目的がすべて空なら節ごと入れない", () => {
    const only = buildPrompt(input({ strategy: { ...emptyStrategyValues(), purposeFuture: "孤立しない街" } })).prompt;
    expect(only).toContain("- 活動の先に作りたい未来: 孤立しない街");
    expect(buildPrompt(input()).prompt).not.toContain("■活動の目的・在り方");
  });

  it("長さの調整で、参考投稿などを減らしても目的の節は削らない（FR-117）", () => {
    const long = "あ".repeat(1900);
    const { prompt, summary } = buildPrompt(
      input({
        strategy: { ...emptyStrategyValues(), purposeOrigin: "上京して寂しかった" },
        referencePosts: Array.from({ length: 10 }, () => ({ body: long, keyword: "", whyGood: long })),
        recentDrafts: Array.from({ length: 20 }, () => long),
      }),
    );
    expect(summary.length).toBeLessThanOrEqual(30000);
    expect(prompt).toContain("- 活動を始めたきっかけ: 上京して寂しかった");
  });
});

describe("splitLengthMix（specs/014 FR-141、research.md R11）", () => {
  it.each([
    [10, [35, 45, 20], [4, 4, 2]],
    [30, [35, 45, 20], [11, 13, 6]],
    [1, [35, 45, 20], [0, 1, 0]],
    [3, [100, 0, 0], [3, 0, 0]],
    [7, [0, 50, 50], [0, 4, 3]],
    [50, [35, 45, 20], [18, 22, 10]],
  ] as const)("%d件・%j → %j（合計はいつも作る件数）", (count, ratios, expected) => {
    const mix = splitLengthMix(count, [...ratios]);
    expect(mix).toEqual(expected);
    expect(mix.reduce((a, b) => a + b, 0)).toBe(count);
  });
});

describe("投稿のプロンプトの直し（specs/014 US10、FR-110〜FR-118・FR-170〜FR-172、contracts/prompt-template.md 1）", () => {
  const full = {
    ...emptyStrategyValues(),
    targetPersona: "上京したばかりの20代",
    contentThemeMix: "東京の暮らし×友だちづくり",
    purposeOrigin: "上京して寂しかった",
    profileBioDraft: "東京で友だちをつくる会の主催\n毎月交流会",
    pinnedPostDraft2: "はじめての人へ",
  };
  const ref = (body: string, extra: Partial<PromptInput["referencePosts"][number]> = {}) => ({ body, keyword: "", whyGood: "", ...extra });

  it("冒頭の直後に「最初に確認すること」と優先順位。宣伝があるときは宣伝投稿と通常投稿の件数を書く（FR-110）", () => {
    const { prompt } = buildPrompt(input({ count: 10, promotions: [promo("交流会")] }));
    expect(prompt).toContain(
      "以下の情報をもとに、Threadsに投稿する文章を10件作ってください。\n\n" +
        "【最初に確認すること(最重要)】\n" +
        "① 投稿は、ちょうど10件（うち宣伝投稿2件・通常投稿8件）。② 投稿と投稿の間は「@@@」だけの行で区切る。③ 1件は150文字以内(500文字は絶対に超えない)。\n" +
        "【ルールがぶつかったときの優先順位】出力のルール ＞ 宣伝投稿の件数 ＞ CORE RULES・NGワード・事実を作らない ＞ 戦略設計(人柄・文体・話題) ＞ 参考情報(リサーチ・投稿ストックの下書き)\n\n" +
        "■話者",
    );
    expect(buildPrompt(input({ count: 10 })).prompt).toContain("① 投稿は、ちょうど10件。② 投稿と投稿の間は");
  });

  it("戦略設計の節に忠実に反映の指示。話題の配分は4項目のどれかがあるときだけ、節の最後に入れる（FR-111・FR-112）", () => {
    const withTheme = buildPrompt(input({ strategy: full })).prompt;
    expect(withTheme).toContain(`■アカウントの戦略設計(設定済みの項目。方向性として必ず踏まえること)\n${FIDELITY}\nターゲット: 上京したばかりの20代`);
    expect(withTheme).toContain(
      "発信テーマの掛け合わせ: 東京の暮らし×友だちづくり\n【話題の配分(必ず守る)】\n" +
        "上の「発信テーマの掛け合わせ」「投稿ジャンル」「ターゲットの本音の悩み」「ターゲットのなりたい姿」に出てくる主な話題を、30件の中に、すべて最低1件ずつ入れること。1つの話題が、全体の4割を超えないようにすること。投稿ジャンルに割合や件数が書かれている場合は、その配分どおりにすること。\n\n",
    );
    const noTheme = buildPrompt(input({ strategy: { ...emptyStrategyValues(), targetPersona: "20代" } })).prompt;
    expect(noTheme).toContain(FIDELITY);
    expect(noTheme).not.toContain("【話題の配分");
  });

  it("下書きがあれば、目的の後・宣伝の前にプロフィールと固定投稿の節。誘う件数は件数÷10を四捨五入、最低1件（FR-113）", () => {
    const { prompt } = buildPrompt(input({ strategy: full, promotions: [promo("交流会")] }));
    expect(prompt).toContain(
      "■現在のプロフィールと固定投稿(このアカウントの軸。すべての投稿の方向性の基準)\n" +
        "- プロフィール文:\n東京で友だちをつくる会の主催\n毎月交流会\n" +
        "- 固定投稿②:\nはじめての人へ\n" +
        "【使い方】\n" +
        "・プロフィールが示す「誰に・何を・どんな価値を届けるか」を軸にして、各投稿を書く。プロフィールの約束と関係ない話題、トーンが食い違う話題は作らない。文章そのものはコピーしない。\n" +
        "・30件のうち3件は、文末で、プロフィールや固定投稿へ自然に誘う一言を添える(毎回違う言い方にする。URLは書かない。宣伝投稿とは別の投稿にする)。",
    );
    expect(prompt).not.toContain("固定投稿①");
    const at = (s: string) => prompt.indexOf(s);
    expect(at("■活動の目的・在り方")).toBeLessThan(at("■現在のプロフィールと固定投稿"));
    expect(at("■現在のプロフィールと固定投稿")).toBeLessThan(at("■今回組み込む宣伝内容"));
    expect(buildPrompt(input({ count: 4, strategy: full })).prompt).toContain("・4件のうち1件は、文末で");
  });

  it("宣伝内容にタイトル・掲載期限と残り日数（当日は0日、期限なし）と、書き方を入れる（FR-114・FR-172）", () => {
    const { prompt } = buildPrompt(
      input({
        count: 10,
        today: "2026-10-17",
        promotions: [
          promo("10/20の交流会", { title: "秋の交流会", validUntil: "2026-10-20", cta: "DMで申し込み" }),
          promo("今日までの割引", { title: "割引", validUntil: "2026-10-17" }),
          promo("いつでも相談", { title: "個別相談" }),
        ],
      }),
    );
    expect(prompt).toContain("1. 【秋の交流会】(掲載期限: 2026-10-20・残り3日) 10/20の交流会 / 行動喚起: DMで申し込み\n");
    expect(prompt).toContain("2. 【割引】(掲載期限: 2026-10-17・残り0日) 今日までの割引\n");
    expect(prompt).toContain("3. 【個別相談】(期限なし) いつでも相談\n");
    expect(prompt).toContain(
      "【宣伝投稿の書き方(宣伝内容を扱う2件に必ず適用する)】\n" +
        "・構成: ①思わず目が止まる1行目(いきなり告知から始めない) → ②読者が自分ごとになる一言 → ③中身(日時・場所・料金・内容は、上の宣伝内容に書かれている事実だけを使う) → ④読者が次にすることを伝える誘導の一言。\n" +
        "・1〜2文ごとに改行し、長い文を作らない。「ぜひご参加ください」「お待ちしております」のような広告の定型文は使わない。\n" +
        "・行動喚起は、そのまま写さず本人の言葉に言い換え、投稿ごとに違う言い回しにする。行動喚起が空の宣伝内容は、コメント・保存などのどれか1つだけを軽く促す。\n" +
        "・同じ宣伝内容でも、切り口を変えて別の投稿にする。",
    );
    // 今日の日付がなければ残り日数は書かない
    const noToday = buildPrompt(input({ promotions: [promo("交流会", { title: "秋", validUntil: "2026-10-20" })] })).prompt;
    expect(noToday).toContain("1. 【秋】(掲載期限: 2026-10-20) 交流会");
  });

  it("参考投稿は本文を1行ずつ「> 」で引用し、鮮度・媒体（Threads以外）・分かっている数字を添える（FR-115）", () => {
    const { prompt } = buildPrompt(
      input({
        referencePosts: [
          ref("1行目\n\n3行目", {
            keyword: "転職",
            whyGood: "数字から入る",
            freshness: "latest",
            platform: "instagram",
            metrics: { views: 32000, likes: 820, replies: null, saves: null, reposts: null, followers: 1800 },
          }),
          ref("Threadsの投稿", { freshness: "unknown", platform: "threads", metrics: { views: null, likes: 5, replies: 2, saves: null, reposts: null, followers: null } }),
        ],
      }),
    );
    expect(prompt).toContain(
      "1. 元の投稿(参考: 内容はコピーしない) [検索語:転職・最新・Instagram・閲覧 32,000・いいね 820・フォロワー 1,800]\n" +
        "   > 1行目\n   >\n   > 3行目\n" +
        "   なぜ良いか: 数字から入る\n",
    );
    expect(prompt).toContain(
      "2. 元の投稿(参考: 内容はコピーしない) [投稿日不明・いいね 5・コメント 2]\n   > Threadsの投稿\n   なぜ良いか: (分析メモなし。フック・構成・感情の動かし方を自分で読み取ること)",
    );
  });

  it("型を使う件数は、入った参考投稿×1.2を切り上げ・最低3件・作る件数まで（FR-115）", () => {
    const posts = (n: number) => Array.from({ length: n }, (_, i) => ref(`参考${i}`));
    const step4 = (count: number, n: number) =>
      `手順4: ${count}件のうち、最低でも${buildPrompt(input({ count, referencePosts: posts(n) })).prompt.match(/最低でも(\d+)件はこの手順で/)![1]}件`;
    expect(step4(30, 10)).toBe("手順4: 30件のうち、最低でも12件");
    expect(step4(30, 1)).toBe("手順4: 30件のうち、最低でも3件");
    expect(step4(2, 10)).toBe("手順4: 2件のうち、最低でも2件");
    expect(buildPrompt(input({ referencePosts: posts(1) })).prompt).toContain(
      "この手順で明確に「型」を踏襲した投稿にすること。同じ参考投稿から何度も型を借りず、なるべく異なる投稿から1件ずつ借りること。新しい参考投稿を優先すること。",
    );
  });

  it("初めの値なら、長さの件数と幅は今と同じ範囲。0件の種類の行は入れない（FR-171、SC-018）", () => {
    const def = buildPrompt(input({ count: 10 })).prompt;
    expect(def).toContain("10件の内訳: 短文4件・中文4件・長文2件(割合は35:45:20)。同じ役割の投稿を3件以上連続させないこと。");
    expect(def).toContain("- 短文(だいたい55文字(44〜66文字)): ");
    expect(def).toContain("- 中文(だいたい100文字(80〜120文字)): ");
    expect(def).toContain("- 長文(だいたい135文字(108〜150文字)): ");
    expect(def).toContain("説明せず言い切るタイプ。");
    const custom = buildPrompt(
      input({
        count: 10,
        lengthSettings: { target: 300, shortLength: 60, mediumLength: 200, longLength: 300, shortRatio: 0, mediumRatio: 50, longRatio: 50 },
      }),
    ).prompt;
    expect(custom).toContain("10件の内訳: 短文0件・中文5件・長文5件(割合は0:50:50)。");
    expect(custom).not.toContain("- 短文(");
    expect(custom).toContain("- 中文(だいたい200文字(160〜240文字)): ");
    expect(custom).toContain("- 長文(だいたい300文字(240〜300文字)): ");
  });

  it("文字数の指示は目標から作る：目標×0.85前後、超えても目標×1.35まで（500文字まで）（FR-171）", () => {
    const def = buildPrompt(input()).prompt;
    expect(def).toContain("- 改行・絵文字・記号もすべて含めた本文全体を、150文字以内におさめること(128文字前後を目標にする)。");
    expect(def).toContain("どうしても収まらないときも、203文字までにすること。500文字は絶対に超えないこと。");
    const big = buildPrompt(
      input({
        lengthSettings: { target: 400, shortLength: 100, mediumLength: 200, longLength: 400, shortRatio: 35, mediumRatio: 45, longRatio: 20 },
      }),
    ).prompt;
    expect(big).toContain("本文全体を、400文字以内におさめること(340文字前後を目標にする)。");
    expect(big).toContain("どうしても収まらないときも、500文字までにすること。");
    expect(big).toContain("③ 1件は400文字以内(500文字は絶対に超えない)。");
  });

  it("出力形式の初めに、出力全体を1つのコードブロックに入れる指示（FR-170）", () => {
    const { prompt } = buildPrompt(input());
    expect(prompt).toContain(
      "■出力形式(必ず守ること。最後の1件まで絶対に崩さないこと。今回最も間違えやすいルールなので特に注意すること)\n" +
        "- 出力全体(全30件と「@@@」の行)を、1つのコードブロック(バッククォート3つ「```」で始まり「```」で終わる枠)の中に入れること。コードブロックの外には、何も書かない。理由: コピーしたときに、改行と「@@@」の行が崩れずに残るため。コードブロックは出力全体で1つだけにし、投稿ごとに分けないこと。\n",
    );
  });

  it("最終チェックは末尾に、材料のある行だけ。件数は冒頭・各節と同じ（FR-116・FR-118、SC-015）", () => {
    const { prompt } = buildPrompt(
      input({ count: 10, strategy: full, promotions: [promo("交流会")], referencePosts: [ref("参考")] }),
    );
    const finalCheck =
      "■出力する前の最終チェック(次を1つずつ確認して、足りないところは直してから出力すること)\n" +
      "□ 投稿は、ちょうど10件になっている(区切り「@@@」は9個)。短文4件・中文4件・長文2件。\n" +
      "□ 1件ずつ、150文字以内(500文字は絶対に超えない)。\n" +
      "□ 上の「戦略設計」と「活動の目的・在り方」の内容が、投稿に表れている。\n" +
      "□ 「発信テーマ」「投稿ジャンル」などに書かれた話題が、すべて最低1件ずつ入っている。\n" +
      "□ 宣伝投稿がちょうど2件あり、そのすべてに、投稿ごとに違う言い回しの誘導の一言がある。\n" +
      "□ リサーチの「型」を使った投稿が、少なくとも3件ある。\n" +
      "□ プロフィールや固定投稿へ誘う投稿が1件ある(宣伝投稿とは別)。\n" +
      "□ 同じ内容・同じ書き出しの投稿がない。ネガティブなまま終わる投稿がない。";
    expect(prompt.endsWith(finalCheck)).toBe(true);
    // 件数は冒頭・各節・最終チェックで同じ
    expect(prompt).toContain("（うち宣伝投稿2件・通常投稿8件）");
    expect(prompt).toContain("宣伝投稿はちょうど2件。残りの8件は");
    expect(prompt).toContain("宣伝内容を扱う2件に必ず適用する");
    expect(prompt).toContain("最低でも3件はこの手順で");
    expect(prompt).toContain("・10件のうち1件は、文末で");
  });

  it("材料が空なら、最終チェックは件数・文字数・同じ内容の3行だけ（SC-016）", () => {
    const { prompt } = buildPrompt(input({ count: 5 }));
    expect(
      prompt.endsWith(
        "■出力する前の最終チェック(次を1つずつ確認して、足りないところは直してから出力すること)\n" +
          "□ 投稿は、ちょうど5件になっている(区切り「@@@」は4個)。短文2件・中文2件・長文1件。\n" +
          "□ 1件ずつ、150文字以内(500文字は絶対に超えない)。\n" +
          "□ 同じ内容・同じ書き出しの投稿がない。ネガティブなまま終わる投稿がない。",
      ),
    ).toBe(true);
    const purposeOnly = buildPrompt(input({ strategy: { ...emptyStrategyValues(), purposeSelf: "頼られる人" } })).prompt;
    expect(purposeOnly).toContain("□ 上の「活動の目的・在り方」の内容が、投稿に表れている。");
  });

  it("長さの調整で、プロフィールと固定投稿・最終チェック・最初に確認することは削らない（FR-117）。length を返す", () => {
    const long = "あ".repeat(1900);
    const result = buildPrompt(
      input({
        strategy: full,
        referencePosts: Array.from({ length: 10 }, () => ref(long, { whyGood: long })),
        recentDrafts: Array.from({ length: 20 }, () => long),
      }),
    );
    expect(result.summary.length).toBeLessThanOrEqual(30000);
    expect(result.summary.recentDraftCount).toBe(0);
    expect(result.length).toBe([...result.prompt].length);
    expect(result.prompt).toContain("■現在のプロフィールと固定投稿");
    expect(result.prompt).toContain("【最初に確認すること(最重要)】");
    expect(result.prompt).toContain("■出力する前の最終チェック");
    // 型を使う件数は、実際に入った参考投稿の数から求める
    const n = result.summary.referencePostCount;
    expect(result.prompt).toContain(`少なくとも${Math.min(30, Math.max(3, Math.ceil(n * 1.2)))}件ある`);
  });
});

import { describe, expect, it } from "vitest";
import { POLICY_PROMPT_RULES } from "../src/policy";
import { buildPrompt, type PromptInput } from "../src/prompt";
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

const promo = (content: string, extra: Partial<PromptInput["promotions"][number]> = {}) => ({
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
    expect(prompt.startsWith("以下の情報をもとに、Threadsに投稿する文章を10件作ってください。\n\n■話者\n表示名: たくみ")).toBe(true);
    expect(prompt).toContain("■重複防止(絶対厳守。最も重要なルールの1つ)");
    expect(prompt).toContain("■短文・中文・長文は「長さ」だけでなく「役割」も変える(必ず守ること)\n10件の中に");
    expect(prompt).toContain("下の「■文字数について」の目安(150文字)");
    expect(prompt).toContain("Threadsの1投稿の上限は500文字で、絵文字だけは1文字ではなくUTF-8のバイト数(多くは4)で数えられる。");
    expect(prompt).not.toContain("500バイト");
    expect(prompt).toContain("10件なら区切り線はちょうど9個になる。出力の最後に区切り線の数を自分で数え、9個になっているか");
    expect(prompt).toContain("事実は上記に書かれているものだけを使う。");
    expect(prompt.endsWith("ThreadsGrowerの投稿ストックの画面にある貼り付け欄に1回で貼り付けてください。\"@@@\"の行で自動的に10件に分割して登録されます(1件ずつコピーし直す必要はありません)。")).toBe(true);
    expect(prompt).not.toContain("{");
  });

  it("入力済みの課題の項目だけを、決まった見出しで含める。下書き（プロフィール・固定投稿）は含めない", () => {
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
      "■アカウントの戦略設計(設定済みの項目。方向性として必ず踏まえること)\nターゲット: 28歳の会社員\n少し焦っている\n人柄(近い人間性): 丁寧・温かい\n成功の指標: DMの数\n\n",
    );
    expect(prompt).not.toContain("ターゲットの本音の悩み");
    expect(prompt).not.toContain("プロフィールの下書き");
    expect(prompt).not.toContain("固定投稿の下書き");
    expect(summary.strategyFilledCount).toBe(3);
  });

  it("材料のない節は見出しごと省く", () => {
    const { prompt, summary } = buildPrompt(input());
    expect(prompt).not.toContain("■アカウントの戦略設計");
    expect(prompt).not.toContain("■今回組み込む宣伝内容");
    expect(prompt).not.toContain("■リサーチで見つけた");
    expect(prompt).not.toContain("投稿ストックにある直近の下書き");
    expect(prompt).toContain("- 上に書かれている宣伝内容・リサーチ内容とも、核となる話題");
    expect(summary).toMatchObject({ strategyFilledCount: 0, promotionCount: 0, referencePostCount: 0, recentDraftCount: 0 });
  });

  it("宣伝に絡める件数：件数30・割合20%で6件程度、件数3・割合10%で1件程度", () => {
    const promotions = [promo("交流会のご案内")];
    expect(buildPrompt(input({ promotions })).prompt).toContain(
      "■今回組み込む宣伝内容(宣伝投稿の割合は20%の設定です。今回生成する30件のうち6件程度に自然に絡めること。",
    );
    expect(buildPrompt(input({ count: 3, promotionRatioPercent: 10, promotions })).prompt).toContain(
      "今回生成する3件のうち1件程度に自然に絡めること。",
    );
  });

  it("宣伝の対象が3件以上のときだけ、偏らせない指示を出す。1件なら並び順・偏りの指示を出さない（Codexレビュー）", () => {
    const three = buildPrompt(input({ promotions: [promo("A"), promo("B"), promo("C")] })).prompt;
    expect(three).toContain(
      "掲載期限が近い順に並んでいます。期限が近いものはやや多めに扱ってよいが、一部だけに偏らせないこと。期限未設定のものも含め、下に掲載している宣伝内容全体をきちんと扱うこと。\n下に3件掲載している宣伝内容のうち、特定の1〜2件だけに偏らせないこと。\n1. A",
    );
    const one = buildPrompt(input({ promotions: [promo("A")] })).prompt;
    expect(one).toContain("残りは宣伝色のない共感・気づき系の投稿にすること)\n1. A\n");
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
    expect(prompt).toContain("掲載期限が近い順に並んでいます。期限が近いものはやや多めに扱ってよいが、2件ともきちんと扱うこと。\n1. 交流会");
    expect(prompt).not.toContain("偏らせない");
    expect(prompt).toContain("1. 交流会(届けたい相手: 場所: 東京 / 年齢: 20代) / 行動喚起: DMで申し込み / 専用URL: https://example.com/e\n2. 相談会\n");
    expect(summary.promotionCount).toBe(2);
  });

  it("参考投稿は新しい順に10件まで。検索語・なぜ良いかの有無で書き分け、型を使う件数は min(3, 件数)", () => {
    const referencePosts = Array.from({ length: 12 }, (_, i) => ({ body: `参考${i}`, keyword: i === 0 ? "転職" : "", whyGood: i === 0 ? "数字から入る" : "" }));
    const { prompt, summary } = buildPrompt(input({ count: 2, referencePosts }));
    expect(prompt).toContain("1. [検索語:転職] 元の投稿(参考: 内容はコピーしない): 参考0\n   なぜ良いか: 数字から入る\n");
    expect(prompt).toContain("2. 元の投稿(参考: 内容はコピーしない): 参考1\n   なぜ良いか: (未記入。投稿の構成から型を読み取ること)");
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
  it.each([4, 2])("時刻%dつ・割合25パーセントは1日1件程度、生成30件は8件程度", (dailyPostCount) => {
    const result = buildPrompt(input({ dailyPostCount, promotionRatioPercent: 25, promotions: [promo("サービス")] }));
    expect(result.prompt).toContain(`1日の投稿は${dailyPostCount}件の設定で、そのうち1件程度、今回生成する30件のうち8件程度`);
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

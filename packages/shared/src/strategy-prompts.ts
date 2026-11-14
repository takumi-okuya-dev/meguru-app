// 課題のAIのプロンプト（specs/014-strategy-guidance research.md R4、contracts/prompt-template.md 2〜4。
// 壁打ちは specs/018-strategy-ai-sparring contracts/prompt-template.md 1）。
// 画面の今の入力（未保存を含む）から作る。アプリはAIを呼ばない（Constitution原則III）。
import {
  PURPOSE_KEYS,
  STRATEGY_FIELDS,
  STRATEGY_SECTIONS,
  TONE_PRESETS,
  strategyFieldOf as fieldOf,
  type StrategyField,
  type StrategyValues,
} from "./strategy";
import { HINTED_KEYS, hintOf, type HintedKey } from "./strategy-guidance";
import { SPARRING_ITEM_END, sparringBeginLine, type SparringKey } from "./strategy-sparring";
import { isBlank } from "./text";

/** 完成版の始まりの目印。Markdown の見出し・区切り線にならない文字にする（research.md R4）。 */
export const FINAL_BEGIN = "【完成版ここから】";
/** 完成版の終わりの目印。 */
export const FINAL_END = "【完成版ここまで】";

/** 深掘りのプロンプトの文脈に入れる項目（数える16項目・目的の5問・活動の軸。下書きは入れない）。 */
const CONTEXT_KEYS: readonly StrategyField["key"][] = [...HINTED_KEYS, "activityAxis"];

/**
 * 項目の値を、プロンプトに書く文字にする。近い人間性は選択肢の名前。空なら null。
 * @param values - 課題の値
 * @param key - 項目のキー
 * @returns 文字、空なら null
 */
function valueText(values: StrategyValues, key: StrategyField["key"]): string | null {
  if (key === "tonePreset") return TONE_PRESETS.find((t) => t.value === values.tonePreset)?.label ?? null;
  const v = values[key];
  return isBlank(v) ? null : v.trim();
}

/**
 * 「この項目をAIと深掘りする」のプロンプト（FR-032・FR-037）。
 * @param key - 深掘りする項目（ヒントを持つ項目）
 * @param values - 課題の今の値（未保存を含む）
 * @returns プロンプト
 */
export function buildDeepenPrompt(key: HintedKey, values: StrategyValues): string {
  const field = fieldOf(key);
  const hint = hintOf(key);
  const context = CONTEXT_KEYS.filter((k) => k !== key).flatMap((k) => {
    const v = valueText(values, k);
    return v === null ? [] : [`- ${fieldOf(k).label}: ${v}`];
  });
  const finalStep =
    key === "contentThemeMix"
      ? "3. 十分に材料がそろったら、掛け合わせの候補を3つ以上出し、それぞれの「集まりそうな人」を添えて、私と相談して1つに決めてから、完成版を書いてください。私が言っていない事実・数字・エピソードは作らないでください。"
      : "3. 十分に材料がそろったら、この項目に入れる完成版を、私の言葉づかいを生かして書いてください。私が言っていない事実・数字・エピソードは作らないでください。";
  const lines = [
    `あなたは、SNS発信の設計を手伝う聞き役です。これから、私のThreadsアカウントの設計の1つの項目「${field.label}」を、一緒に深掘りして完成させてください。`,
    "",
    "■この項目で考えること",
    field.description,
  ];
  if (hint) {
    lines.push(
      "",
      "■考えるヒント",
      `コツ: ${hint.tip}`,
      `悪い例: ${hint.bad}`,
      `良い例: ${hint.good}`,
      `足してみたい観点: ${hint.more.join("・")}`,
      `こんな場合はどうだろう？: ${hint.whatIf}`,
      `もっと良くするなら: ${hint.better}`,
    );
  }
  lines.push("", "■今の私の答え", valueText(values, key) ?? "未入力");
  if (context.length > 0) {
    lines.push("", "■ほかの項目に書いたこと(参考。この項目と食い違わないように)", ...context);
  }
  lines.push(
    "",
    "■進め方",
    "1. 私の今の答えとヒントをもとに、足りないところを、一度に1〜2問ずつ質問してください。質問は、答えやすい具体的な問いにしてください。",
    "2. 私が答えたら、必要なら次の質問をしてください(3〜5往復を目安に)。",
    finalStep,
    "4. 完成版は、次の2行のあいだに書いてください。目印の行は、そのまま書き写してください。",
    FINAL_BEGIN,
    "(完成版)",
    FINAL_END,
  );
  return lines.join("\n");
}

/**
 * AIの答えから、反映する内容を取り出す（FR-033）。目印の組があれば最初の組の内側、なければ全体。
 * @param text - 貼り付けたAIの答え
 * @returns 反映する内容（前後の空白を除く）と、目印の組があったか
 */
export function extractFinal(text: string): { text: string; marked: boolean } {
  const begin = text.indexOf(FINAL_BEGIN);
  if (begin >= 0) {
    const end = text.indexOf(FINAL_END, begin + FINAL_BEGIN.length);
    if (end >= 0) return { text: text.slice(begin + FINAL_BEGIN.length, end).trim(), marked: true };
  }
  return { text: text.trim(), marked: false };
}

/**
 * 「全体をAIと整理する」のプロンプト（FR-041）。区分ごとに全項目（下書きを除く）を並べ、
 * 重複・矛盾・抜けを質問の形で出してもらう。答えはアプリに取り込まない（FR-042）。
 * @param values - 課題の今の値（未保存を含む）
 * @returns プロンプト
 */
export function buildOverallPrompt(values: StrategyValues): string {
  const lines = [
    "あなたは、SNS発信の設計を見直す相談相手です。下は、私のThreadsアカウントの設計です。項目どうしの重複・矛盾・抜けを見つけて、直すための質問をしてください。",
  ];
  for (const section of STRATEGY_SECTIONS) {
    if (section.id === "drafts") continue;
    lines.push("", `■${section.title}`);
    for (const f of STRATEGY_FIELDS.filter((x) => x.section === section.id)) {
      lines.push(`- ${f.label}: ${valueText(values, f.key) ?? "未入力"}`);
    }
  }
  lines.push(
    "",
    "■お願い",
    "1. 重複している・食い違っている・足りないと思う所を、項目の名前を挙げて、項目ごとに質問の形で出してください(例: 「ターゲット」と「来てほしくない人」が重なっていませんか？)。",
    "2. 項目を勝手に書き直さないでください。私が答えを考えるための質問だけにしてください。",
    "3. 大事な順に、多くても10問にしてください。",
  );
  return lines.join("\n");
}

/**
 * 「5問からAIと整理する」（活動の軸）のプロンプト（FR-036）。
 * @param values - 課題の今の値（未保存を含む）
 * @returns プロンプト
 */
export function buildAxisPrompt(values: StrategyValues): string {
  const questions = PURPOSE_KEYS.filter((k) => k !== "activityAxis").map((k) => {
    const question = fieldOf(k).label.replace(/^Q\d：/, "");
    return `- ${question}: ${valueText(values, k) ?? "未入力"}`;
  });
  return [
    "あなたは、活動の軸を言葉にする手伝いをする聞き役です。下は、私の活動の目的・在り方の5つの問いへの答えです。",
    "",
    ...questions,
    "",
    "■お願い",
    "5つの答えに共通する思いを、短い一言(20文字前後)にまとめた「活動の軸」の案を3つ出してください。それぞれに、どの答えのどこから考えたかを1行添えてください。私が書いていない事実は足さないでください。",
    "3つの案は、次の2行のあいだに書いてください。目印の行は、そのまま書き写してください。",
    FINAL_BEGIN,
    "1. (案)",
    "2. (案)",
    "3. (案)",
    FINAL_END,
  ].join("\n");
}

/**
 * 「AIと壁打ちして埋める」のプロンプト（specs/018 FR-006・FR-007）。質問の対象の項目をまとめて相談し、
 * 最後に項目ごとの完成版を決まった目印で出してもらう。長さは削らない。
 * @param values - 課題の今の値（未保存を含む）
 * @param targets - 質問の対象（表示の順）
 * @returns プロンプト
 */
export function buildSparringPrompt(values: StrategyValues, targets: readonly SparringKey[]): string {
  const lines = [
    `あなたは、SNS発信の設計を手伝う聞き役です。これから、私のThreadsアカウントの設計のうち、下の${targets.length}項目を、一緒に考えて完成させてください。`,
    "",
    "■一緒に考える項目",
  ];
  targets.forEach((key, i) => {
    const field = fieldOf(key);
    const hint = hintOf(key);
    if (i > 0) lines.push("");
    lines.push(`【${i + 1}】${field.label}`, `考えること: ${field.description}`);
    if (hint) {
      lines.push(
        `コツ: ${hint.tip}`,
        `悪い例: ${hint.bad}`,
        `良い例: ${hint.good}`,
        `足してみたい観点: ${hint.more.join("・")}`,
        `こんな場合はどうだろう？: ${hint.whatIf}`,
        `もっと良くするなら: ${hint.better}`,
      );
    }
    lines.push(`今の私の答え: ${valueText(values, key) ?? "未入力"}`);
  });
  // 文脈は深掘りと同じ集まり（近い人間性を含み、下書きを含まない）から、質問の対象を除いたもの
  const context = CONTEXT_KEYS.filter((k) => !(targets as readonly string[]).includes(k)).flatMap((k) => {
    const v = valueText(values, k);
    return v === null ? [] : [`- ${fieldOf(k).label}: ${v}`];
  });
  if (context.length > 0) {
    lines.push("", "■ほかの項目に書いたこと(参考。食い違わないように)", ...context);
  }
  lines.push(
    "",
    "■進め方",
    "1. 上の項目を順に、一度に1〜2問ずつ質問してください。質問は、答えやすい具体的な問いにしてください。",
    "2. 私の答えにないこと(事実・数字・エピソード)は作らないでください。",
    "3. 今の私の答えがある項目は、その文を生かして足したり直したりしてください。別の内容に書き換えないでください。",
    "4. 項目どうしで、重なりや食い違いがないようにしてください。",
    "5. すべての項目を聞き終えたら、項目ごとの完成版を、下の「完成版の形」で出してください。途中で私が「完成版を出して」と送ったら、その時点までの内容で出してください(材料が足りない項目は、出さなくてかまいません)。",
  );
  if (targets.includes("contentThemeMix")) {
    lines.push(
      "6. 「発信テーマの掛け合わせ」は、候補を3つ以上出し、それぞれの「集まりそうな人」を添えて、私と相談して1つに決めてください。",
    );
  }
  lines.push(
    "",
    "■完成版の形",
    "項目ごとに、始まりの目印の行・完成版・終わりの目印の行の順に書いてください。目印の行は、項目の名前も含めて、そのまま書き写してください。完成版のほかに説明を書くときは、目印の外に書いてください。",
  );
  for (const key of targets) {
    lines.push("", sparringBeginLine(fieldOf(key).label), "(完成版)", SPARRING_ITEM_END);
  }
  return lines.join("\n");
}


// 課題のAIのプロンプト（specs/014-strategy-guidance research.md R4、contracts/prompt-template.md 2〜4）。
// 画面の今の入力（未保存を含む）から作る。アプリはAIを呼ばない（Constitution原則III）。
import { STRATEGY_FIELDS, TONE_PRESETS, type StrategyField, type StrategyValues } from "./strategy";
import { HINTED_KEYS, hintOf, type HintedKey } from "./strategy-guidance";
import { isBlank } from "./text";

/** 完成版の始まりの目印。Markdown の見出し・区切り線にならない文字にする（research.md R4）。 */
export const FINAL_BEGIN = "【完成版ここから】";
/** 完成版の終わりの目印。 */
export const FINAL_END = "【完成版ここまで】";

/** 深掘りのプロンプトの文脈に入れる項目（数える16項目・目的の5問・活動の軸。下書きは入れない）。 */
const CONTEXT_KEYS: readonly StrategyField["key"][] = [...HINTED_KEYS, "activityAxis"];

function fieldOf(key: StrategyField["key"]): StrategyField {
  const f = STRATEGY_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`unknown strategy field: ${key}`);
  return f;
}

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

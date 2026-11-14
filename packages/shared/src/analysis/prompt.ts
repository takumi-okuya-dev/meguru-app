// 傾向をプロンプトに入れる守りと、内容の分類のプロンプト・答えの読み取り（specs/022-algorithm-analysis research.md R7・R8、
// contracts/analysis.md）。分類は外のAIに頼み、答えを貼る（018と同じ形。原則III）。
import { ANALYSIS_MAX_TRENDS } from "../limits";
import { findNgWords } from "../ng-words";
import { normalizeForMatch } from "../normalize";
import { OPENING_TYPE_LABELS, OPENING_TYPES, type AnalysisTheme, type OpeningType, type TextFeature, type Trend } from "./types";

/** CORE RULESの行に出てくると、その特徴の傾向を入れない言葉（research.md R7）。 */
const RULE_WORDS: Record<TextFeature, RegExp> = {
  question: /問いかけ|質問/,
  number: /数字/,
  shortFirstLine: /1行目|１行目|書き出し/,
  manyLines: /改行/,
  emoji: /絵文字/,
  callout: /呼びかけ/,
};

/**
 * プロンプトに入れる傾向を選ぶ（FR-041、research.md R7）。本文で変えられる傾向だけで、CORE RULESに出てくる特徴と
 * NGワードを含む傾向は入れない（原則I）。
 * @param trends - 傾向（倍率の大きい順）
 * @param coreRules - CORE RULESの空でない行
 * @param ngWords - NGワード
 * @returns 入れる傾向（5つまで）
 */
export function trendsForPrompt(trends: readonly Trend[], coreRules: readonly string[], ngWords: readonly string[]): Trend[] {
  const rules = coreRules.join("\n");
  const ng = ngWords.map((word) => ({ word }));
  return trends
    .filter((t) => t.promptable)
    .filter((t) => !(t.dimension === "feature" && RULE_WORDS[t.key as TextFeature]?.test(rules)))
    .filter((t) => findNgWords(t.text, ng).length === 0)
    .slice(0, ANALYSIS_MAX_TRENDS);
}

/** 分類のプロンプトに入れる投稿。 */
export type ClassifyTarget = { draftId: string; body: string };

/**
 * 内容の分類のプロンプト（contracts/analysis.md「分類のプロンプト」）。投稿には【1】からの番号を付ける。
 * @param posts - 投稿（番号の順）
 * @param themes - テーマの一覧
 * @returns プロンプト
 */
export function classifyPrompt(posts: readonly ClassifyTarget[], themes: readonly AnalysisTheme[]): string {
  const withTheme = themes.length > 0;
  return [
    `あなたは、SNSの投稿を分類するアシスタントです。次のThreadsの投稿を、1件ずつ「書き出しの型」${withTheme ? "と「テーマ」" : ""}に分けてください。`,
    "",
    "# 書き出しの型(この中から1つ)",
    OPENING_TYPES.map((t) => OPENING_TYPE_LABELS[t]).join("／"),
    "",
    withTheme ? "# テーマ(この中から1つ。合うものがなければ「なし」)" : "# テーマ",
    withTheme ? themes.map((t) => t.name).join("／") : "なし(テーマは付けない)",
    "",
    "# 守ること",
    "・一覧にない名前を作らない",
    "・投稿の番号を変えない。全部の投稿に1行ずつ答える",
    "・質問はせず、答えだけを返す",
    "",
    "# 答えの形(この形の行だけを返す)",
    withTheme ? "【1】書き出しの型：あるある／テーマ：仕事の悩み" : "【1】書き出しの型：あるある",
    "",
    "# 投稿",
    ...posts.flatMap((p, i) => [`【${i + 1}】`, p.body, ""]),
  ]
    .join("\n")
    .trimEnd();
}

/** 読み取った分類。 */
export type ClassifyItem = { index: number; draftId: string; openingType: OpeningType; themeId: string | null };
/** 読み取れなかった投稿。 */
export type ClassifyProblem = { index: number; reason: string };

// 名前の比べ方：前後の空白と「」『』"" を除き、全角・半角をそろえる
const keyOf = (s: string) => normalizeForMatch(s.replace(/[「」『』"“”\s]/g, "")).normalized;

const LINE_RE = /【\s*([0-9０-９]+)\s*】(.*)$/;
const OPENING_RE = /書き出しの型\s*[:：]\s*([^／/、,]*)/;
const THEME_RE = /テーマ\s*[:：]\s*([^／/、,]*)/;

/**
 * 分類の答えを読む（contracts/analysis.md「答えの読み取り」）。目印の行だけを読み、前後の文は無視する。
 * @param text - 貼った答え
 * @param posts - 投稿（プロンプトの番号の順）
 * @param themes - テーマの一覧
 * @returns 読み取れた分類と、読み取れなかった投稿（番号の順）
 */
export function parseClassifyAnswer(
  text: string,
  posts: readonly ClassifyTarget[],
  themes: readonly AnalysisTheme[],
): { items: ClassifyItem[]; problems: ClassifyProblem[] } {
  const openings = new Map(OPENING_TYPES.map((t) => [keyOf(OPENING_TYPE_LABELS[t]), t] as const));
  const themeIds = new Map(themes.map((t) => [keyOf(t.name), t.id] as const));
  const byIndex = new Map<number, ClassifyItem | ClassifyProblem>();
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const index = Number(normalizeForMatch(m[1]!).normalized);
    if (index < 1 || index > posts.length) continue;
    const rest = m[2]!;
    const openingName = OPENING_RE.exec(rest)?.[1]?.trim() ?? "";
    const openingType = openings.get(keyOf(openingName));
    if (!openingType) {
      byIndex.set(index, { index, reason: `知らない書き出しの型「${openingName}」` });
      continue;
    }
    const themeName = THEME_RE.exec(rest)?.[1]?.trim() ?? "";
    const themeKey = keyOf(themeName);
    let themeId: string | null = null;
    if (themeKey !== "" && themeKey !== keyOf("なし")) {
      const id = themeIds.get(themeKey);
      if (!id) {
        byIndex.set(index, { index, reason: `知らないテーマ「${themeName}」` });
        continue;
      }
      themeId = id;
    }
    byIndex.set(index, { index, draftId: posts[index - 1]!.draftId, openingType, themeId });
  }
  const items: ClassifyItem[] = [];
  const problems: ClassifyProblem[] = [];
  posts.forEach((_, i) => {
    const r = byIndex.get(i + 1);
    if (!r) problems.push({ index: i + 1, reason: "答えがない" });
    else if ("reason" in r) problems.push(r);
    else items.push(r);
  });
  return { items, problems };
}

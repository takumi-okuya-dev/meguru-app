// 外部媒体展開の入口（specs/021-external-media research.md R1〜R5）。APIとWebの両方が、ここだけを呼ぶ。
// 組み立て・自動の直し・ルールのチェック・作業のSTEP・まとめてコピー・画像とAIのプロンプトを、媒体の決まりから作る（アプリの中でAIを呼ばない。原則III）。
import { buildImagePrompt, commonChecks, fixListing } from "./common";
import { JMTY } from "./jmty";
import { KOKUCHPRO } from "./kokuchpro";
import { PEATIX } from "./peatix";
import { TSUNAGATE } from "./tsunagate";
import {
  MEDIA_LABELS,
  type ImageStyle,
  type ListingCheck,
  type ListingFix,
  type ListingSource,
  type ListingValues,
  type Media,
  type MediaDefinition,
  type MediaField,
  type WorkStep,
} from "./types";
import { YOUTRUST } from "./youtrust";

export * from "./types";
export { applyFixRules } from "./common";

/** 媒体ごとの決まり。 */
export const MEDIA_DEFINITIONS: Record<Media, MediaDefinition> = {
  kokuchpro: KOKUCHPRO,
  peatix: PEATIX,
  tsunagate: TSUNAGATE,
  jmty: JMTY,
  youtrust: YOUTRUST,
};

/** 「AIと整える」で直す本文の欄（タイトルはどの媒体も title）。 */
const BODY_KEY: Record<Media, string> = { kokuchpro: "body", peatix: "body", tsunagate: "intro", jmty: "body", youtrust: "summary" };

/**
 * 媒体の本文の欄の key。
 * @param media - 媒体
 * @returns key
 */
export const listingBodyKey = (media: Media): string => BODY_KEY[media];

/** 作った掲載内容。 */
export type BuiltListing = { fields: ListingValues; fixes: ListingFix[]; reasons: Record<string, string>; titleCandidates: string[] };

/**
 * 掲載内容を作る（組み立て → 自動の直し → 足すもの）。
 * @param media - 媒体
 * @param src - 材料
 * @returns 欄の値・自動で直した内容・選んだ理由・タイトルのほかの案
 */
export function buildListing(media: Media, src: ListingSource): BuiltListing {
  const def = MEDIA_DEFINITIONS[media];
  const built = def.build(src);
  const fixed = fixListing(def, built.fields);
  const fields = def.finalize ? def.finalize(fixed.fields, src) : fixed.fields;
  return { fields, fixes: fixed.fixes, reasons: built.reasons, titleCandidates: built.titleCandidates };
}

/**
 * 直した・貼った欄の値に、自動の直しをもう一度通す（保存のとき。spec FR-012a・FR-022）。
 * @param media - 媒体
 * @param values - 欄の値
 * @param src - 材料
 * @returns 直したあとの値と、新しく外した内容
 */
export function refixListing(media: Media, values: ListingValues, src: ListingSource): { fields: ListingValues; fixes: ListingFix[] } {
  const def = MEDIA_DEFINITIONS[media];
  const fixed = fixListing(def, values);
  return { fields: def.finalize ? def.finalize(fixed.fields, src) : fixed.fields, fixes: fixed.fixes };
}

/**
 * ルールのチェック（その場で計算する。保存しない。research.md R5）。
 * @param media - 媒体
 * @param values - 欄の値
 * @param src - 材料
 * @param fixCount - 自動で直した件数
 * @returns 赤・黄・参考の項目（赤 → 黄 → 参考の順）
 */
export function checkListing(media: Media, values: ListingValues, src: ListingSource, fixCount = 0): ListingCheck[] {
  const def = MEDIA_DEFINITIONS[media];
  const out = [...commonChecks(def, values), ...def.rules(values, src)];
  if (!src.event?.endAt) out.push({ level: "yellow", message: "終了の日時がありません。決めて入れてください" });
  if (src.event && src.event.feeYen === null) out.push({ level: "yellow", message: "参加費の金額がありません。金額の欄に入れてください" });
  if (fixCount > 0) out.push({ level: "info", message: `自動で直した内容が${fixCount}件あります（「自動で直した内容」で確かめられます）` });
  const order = { red: 0, yellow: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** 作業の画面のSTEP（値を差し込んだもの）。 */
export type FilledWorkStep = WorkStep & { values: { field: MediaField; value: string }[]; notes: readonly string[] };

/**
 * 作業の画面のSTEPに、欄の値を差し込む。
 * @param media - 媒体
 * @param values - 欄の値
 * @returns STEP
 */
export function workSteps(media: Media, values: ListingValues): FilledWorkStep[] {
  const def = MEDIA_DEFINITIONS[media];
  return def.workSteps.map((s) => ({
    ...s,
    values: (s.fields ?? []).map((key) => ({ field: def.fields.find((f) => f.key === key)!, value: values[key] ?? "" })),
    notes: s.publish
      ? ["公開したら、入力の画面の「掲載URL」にURLを保存し、状況を「掲載済み」にしてください。", ...def.publishNotes]
      : [],
  }));
}

/**
 * 「まとめてコピー」の文（区切りごとに、欄の名前つき。spec FR-015）。
 * @param media - 媒体
 * @param values - 欄の値
 * @returns 文
 */
export function listingAsText(media: Media, values: ListingValues): string {
  const def = MEDIA_DEFINITIONS[media];
  const parts: string[] = [`【${MEDIA_LABELS[media]}の掲載内容】`];
  def.steps.forEach((step, i) => {
    const rows = def.fields.filter((f) => f.step === i && (values[f.key] ?? "").trim() !== "");
    if (rows.length === 0) return;
    parts.push("", `■${step}`);
    for (const f of rows) parts.push(`【${f.label}】`, values[f.key]!);
  });
  return parts.join("\n");
}

/**
 * 画像を作るためのプロンプト。
 * @param media - 媒体
 * @param src - 材料
 * @param style - 画像の種類
 * @returns プロンプト
 */
export function imagePrompt(media: Media, src: ListingSource, style: ImageStyle): string {
  return buildImagePrompt(MEDIA_DEFINITIONS[media], src, style, MEDIA_LABELS[media]);
}

/** 「AIと整える」の答えの目印（018の目印と同じ考え方）。 */
export const POLISH_TITLE = "【タイトル】";
/** 本文の目印。 */
export const POLISH_BODY = "【本文】";
/** 終わりの目印。 */
export const POLISH_END = "【ここまで】";

/**
 * 「AIと整える」のプロンプト（外のAIに貼る。spec FR-012a、research.md R3）。
 * @param media - 媒体
 * @param src - 材料
 * @param values - 今の欄の値
 * @returns プロンプト
 */
export function polishPrompt(media: Media, src: ListingSource, values: ListingValues): string {
  const def = MEDIA_DEFINITIONS[media];
  const titleField = def.fields.find((f) => f.key === "title");
  return [
    `あなたは、イベントの集客文を書くプロです。次のイベントを「${MEDIA_LABELS[media]}」に載せるので、タイトルと本文の言い回しを整えてください。`,
    "",
    "# 守ること",
    ...def.polishGuide.map((g) => `・${g}`),
    titleField?.max ? `・タイトルは${titleField.max}文字以内` : null,
    "・事実（日時・場所・参加費・内容）は、下に書かれていることだけを使う。足したり変えたりしない",
    "・質問はせず、答えだけを返す",
    "",
    "# 今のタイトル",
    values.title ?? src.title,
    "",
    "# 今の本文",
    values[BODY_KEY[media]] ?? src.content,
    "",
    "# 答えの形（この目印の行を、そのまま使う）",
    POLISH_TITLE,
    "（タイトル）",
    POLISH_BODY,
    "（本文）",
    POLISH_END,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * 「AIと整える」の答えを読む。目印の前後の文は無視し、取れた分だけ返す。
 * @param text - 貼った答え
 * @returns タイトルと本文（取れなければ null）
 */
export function parsePolishAnswer(text: string): { title: string | null; body: string | null } {
  const t = text.replace(/\r\n/g, "\n");
  const pick = (start: string, ends: string[]) => {
    const i = t.indexOf(start);
    if (i < 0) return null;
    const rest = t.slice(i + start.length);
    const cut = Math.min(...ends.map((e) => (rest.indexOf(e) < 0 ? rest.length : rest.indexOf(e))));
    const v = rest.slice(0, cut).trim();
    return v === "" ? null : v;
  };
  return { title: pick(POLISH_TITLE, [POLISH_BODY, POLISH_END]), body: pick(POLISH_BODY, [POLISH_END, POLISH_TITLE]) };
}

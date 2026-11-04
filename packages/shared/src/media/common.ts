// 媒体に共通の組み立て・行の直し・ルール・画像のプロンプト（specs/021-external-media contracts/media.md「共通」、research.md R2〜R5）。
import {
  eventDateParts,
  formatEventAddress,
  formatEventFee,
  formatEventPlace,
  formatEventShortDate,
  formatEventWhen,
  type PromotionEvent,
} from "../promotion-event";
import { countChars } from "../text";
import type { FixRule, ImageStyle, ListingCheck, ListingFix, ListingSource, ListingValues, MediaDefinition } from "./types";

// ---- 行の直し（research.md R4）----

const URL_RE = /https?:\/\/|www\.|maps\.app\.goo\.gl|goo\.gl\//i;
// 「オンライン」「online」に当たらないよう、カタカナは前が「ン」でないもの、英字は大文字の LINE だけにする
const LINE_RE = /(^|[^ン])ライン|LINE|line\.me|lin\.ee/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_RE = /(^|[^\d])0\d{1,4}-?\d{1,4}-?\d{3,4}([^\d]|$)/;
const BANK_RE = /口座|振込先|銀行|支店|普通預金|PayPay|ペイペイ/i;

/** 外部のURL（地図を含む）。 */
export const FIX_URL: FixRule = { reason: "外部のサイトへのURL（媒体の外へ誘導しない）", test: (l) => URL_RE.test(l) };
/** LINEの案内。 */
export const FIX_LINE: FixRule = { reason: "LINEの案内（媒体の外でのやりとり）", test: (l) => LINE_RE.test(l) };
/** メールアドレス。 */
export const FIX_EMAIL: FixRule = { reason: "メールアドレス（連絡先）", test: (l) => EMAIL_RE.test(l) };
/** 電話番号。 */
export const FIX_PHONE: FixRule = { reason: "電話番号（連絡先）", test: (l) => PHONE_RE.test(l) };
/** 口座・PayPay。 */
export const FIX_BANK: FixRule = { reason: "口座・PayPayの案内（媒体の外での支払い）", test: (l) => BANK_RE.test(l) };

// 書き出し（40字まで）
const excerptOf = (line: string) => {
  const chars = [...line.trim()];
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : chars.join("");
};

/**
 * 文を行に分け、決まりに当たる行を外す。外した行は、欄・書き出し・理由として残す。
 * @param field - 欄の key
 * @param text - 文
 * @param rules - 行を外す決まり
 * @returns 外したあとの文と、外した内容
 */
export function applyFixRules(field: string, text: string, rules: readonly FixRule[]): { text: string; fixes: ListingFix[] } {
  if (rules.length === 0) return { text, fixes: [] };
  const fixes: ListingFix[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const rule = line.trim() === "" ? undefined : rules.find((r) => r.test(line));
    if (rule) fixes.push({ field, excerpt: excerptOf(line), reason: rule.reason });
    else kept.push(line);
  }
  // 外した行のあとに続く空行が重ならないようにする
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), fixes };
}

/**
 * 媒体の、直す欄すべてに決まりを通す。
 * @param def - 媒体の決まり
 * @param values - 欄の値
 * @returns 直したあとの値と、外した内容
 */
export function fixListing(def: MediaDefinition, values: ListingValues): { fields: ListingValues; fixes: ListingFix[] } {
  const fields = { ...values };
  const fixes: ListingFix[] = [];
  for (const f of def.fields) {
    if (!f.fixable || !fields[f.key]) continue;
    const r = applyFixRules(f.key, fields[f.key]!, def.fixRules);
    fields[f.key] = r.text;
    fixes.push(...r.fixes);
  }
  return { fields, fixes };
}

// ---- 組み立ての部品 ----

/**
 * 文字数（絵文字も1文字）。
 * @param s - 文字
 * @returns 文字数
 */
export const lengthOf = (s: string): number => countChars(s);

/**
 * 上限で切る（上限がなければそのまま）。
 * @param s - 文字
 * @param max - 上限
 * @returns 切ったもの
 */
export function clip(s: string, max: number | undefined): string {
  if (max === undefined) return s;
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("") : s;
}

/**
 * 開始・終了の日付と時刻（なければ空）。
 * @param e - イベントの情報
 * @returns 日付と時刻
 */
export function dateFields(e: PromotionEvent | null): { startDate: string; startTime: string; endDate: string; endTime: string } {
  if (!e) return { startDate: "", startTime: "", endDate: "", endTime: "" };
  const s = eventDateParts(e.startAt);
  const t = e.endAt ? eventDateParts(e.endAt) : null;
  return { startDate: s.date, startTime: s.time, endDate: t?.date ?? "", endTime: t?.time ?? "" };
}

/**
 * 「YYYY-MM-DD HH:mm」の形（つなげーと・ジモティー）。
 * @param at - 「YYYY-MM-DDTHH:mm」（なければ null）
 * @returns 文字列（なければ空）
 */
export const spacedDateTime = (at: string | null | undefined): string => (at ? at.replace("T", " ") : "");

/**
 * 宣伝内容の本文から、タイトルと同じ1行目などの余計なものを除いたもの。
 * @param src - 材料
 * @returns 本文
 */
export const contentOf = (src: ListingSource): string => src.content.trim();

/**
 * イベントの情報を「■」の見出しで並べた行（日時・場所・住所・参加費・キャンセル）。
 * @param src - 材料
 * @param opts - address：住所を入れるか、cancel：キャンセルの決まりを入れるか
 * @returns 行
 */
export function eventBlock(src: ListingSource, opts: { address?: boolean; cancel?: boolean } = {}): string[] {
  const e = src.event;
  if (!e) return [];
  const lines = [`■日時：${formatEventWhen(e)}`];
  const place = formatEventPlace(e);
  if (place) lines.push(`■場所：${place}`);
  const addr = formatEventAddress(e);
  if (opts.address !== false && addr && e.format === "venue") lines.push(`■住所：${addr}`);
  const fee = formatEventFee(e);
  if (fee) lines.push(`■参加費：${fee}`);
  if (e.feeNote && e.feeYen !== null) lines.push(e.feeNote);
  if (e.capacity) lines.push(`■定員：${e.capacity}名`);
  if (opts.cancel !== false && e.cancelPolicy) lines.push("", "■キャンセルについて", e.cancelPolicy);
  return lines;
}

/**
 * 内容の言葉から、どんな会かの目安（交流会・勉強会・スポーツ・その他）。
 * @param src - 材料
 * @returns 会の種類
 */
export function eventKind(src: ListingSource): "party" | "seminar" | "workshop" | "sports" | "other" {
  const t = `${src.title}\n${src.content}`;
  if (/バスケ|フットサル|バドミントン|ピックルボール|スポーツ|運動会|ランニング|テニス/.test(t)) return "sports";
  if (/勉強会|セミナー|講座|学ぶ|キャリア相談/.test(t)) return "seminar";
  if (/ワークショップ|体験会|作ってみる/.test(t)) return "workshop";
  if (/交流会|飲み会|会|パーティー|BBQ|バー|ボドゲ|ボードゲーム/.test(t)) return "party";
  return "other";
}

/**
 * 最寄り駅の名前だけ（例：「御徒町駅 徒歩3分」→「御徒町」）。
 * @param e - イベントの情報
 * @returns 駅の名前（なければ空）
 */
export function stationName(e: PromotionEvent | null): string {
  const st = e?.station?.trim();
  if (!st) return "";
  return st.replace(/駅.*$/, "").trim();
}

/**
 * よく使う短い日付（例：11/25(水)）。
 * @param src - 材料
 * @returns 日付（なければ空）
 */
export const shortDateOf = (src: ListingSource): string => (src.event ? formatEventShortDate(src.event.startAt) : "");

// ---- 共通のルール（research.md R5）----

/**
 * 必須の欄が空・上限を超える、を調べる（どの媒体でも同じ）。
 * @param def - 媒体の決まり
 * @param values - 欄の値
 * @returns 項目
 */
export function commonChecks(def: MediaDefinition, values: ListingValues): ListingCheck[] {
  const out: ListingCheck[] = [];
  for (const f of def.fields) {
    const v = values[f.key] ?? "";
    if (f.required && v.trim() === "") out.push({ level: "yellow", field: f.key, message: `「${f.label}」が空です。入れてください` });
    if (f.max !== undefined && lengthOf(v) > f.max)
      out.push({ level: "red", field: f.key, message: `「${f.label}」が${f.max}文字を超えています（${lengthOf(v)}文字）` });
  }
  return out;
}

// ---- 画像のプロンプト（contracts/media.md「共通」）----

const COMMON_IMAGE_AVOID = ["URL", "QRコード", "連絡先（LINE・メール・電話番号）", "他のサイトやSNSの名前", "口座の情報"];

/**
 * 画像を作るためのプロンプト（外のAIに貼る。アプリの中では画像を作らない。原則III）。
 * @param def - 媒体の決まり
 * @param src - 材料
 * @param style - 画像の種類
 * @param mediaLabel - 媒体の名前
 * @returns プロンプト
 */
export function buildImagePrompt(def: MediaDefinition, src: ListingSource, style: ImageStyle, mediaLabel: string): string {
  const e = src.event;
  const facts = [
    `・イベント名：${src.title}`,
    e ? `・日時：${formatEventWhen(e)}` : null,
    e && formatEventPlace(e) ? `・場所：${formatEventPlace(e)}` : null,
    e?.audience ? `・対象者：${e.audience}` : null,
    e && formatEventFee(e) ? `・参加費：${formatEventFee(e)}` : null,
    `・内容：${clip(contentOf(src).replace(/\n+/g, " "), 300)}`,
  ].filter((l): l is string => l !== null);
  return [
    `あなたは、イベント集客のバナーを作るプロのグラフィックデザイナーです。「${mediaLabel}」の一覧で目立ち、何のイベントか・初めてでも参加しやすいかが一瞬で伝わるメイン画像を1枚作ってください。`,
    "",
    "# イベントの情報（ここに書かれたことだけを使う。推測で足さない）",
    ...facts,
    "",
    "# 画像の決まり",
    `・大きさ：${def.image.size}`,
    `・置き方：${def.image.layout}`,
    `・よく見られる形：${def.image.trend}`,
    "・見出しは2行、1行6文字以内（日付・回数・絵文字・【】は入れない）。大事な言葉1つの下にだけ、アクセント色の帯を引く。",
    "・色は、背景・文字・アクセントの3色まで。",
    "・バッジは3つまで。イベントの情報に根拠のあるもの（初参加歓迎・一人参加OK・エリア名）だけ。",
    "・参加費を入れるときは、上の参加費と同じ金額にする。",
    `・入れてはいけないもの：${[...COMMON_IMAGE_AVOID, ...def.image.avoid].join("・")}`,
    "",
    style === "photo"
      ? "# スタイル：写真を使う型（私が添付した写真を背景や主役に使い、文字とバッジを重ねる。顔をぼかしたり隠したりしない）"
      : "# スタイル：イラスト型（大人3〜5人が卓を囲んで自然に会話している、あたたかいイラスト。イベントに合う小物を1つだけ置く）",
    "",
    "作る前に、見出し・アクセント色・描くシーン・バッジを3行以内で書き、確認を求めずにそのまま画像を作ってください。",
  ].join("\n");
}

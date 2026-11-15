// ジモティー（specs/021-external-media contracts/media.md「ジモティー」）。本文に連絡先を書けず、「出会い」を連想させる言葉も避ける。
// URLは禁止ではないが、案内は最後の「詳細・お申し込み」の1か所にまとめる。
import { formatEventAddress, formatEventFee, formatEventPlace, formatEventWhen } from "../promotion-event";
import { FIX_BANK, FIX_EMAIL, FIX_LINE, FIX_PHONE, FIX_URL, contentOf, eventKind, shortDateOf, spacedDateTime, stationName } from "./common";
import type { BuiltValues, FixRule, ListingCheck, ListingSource, ListingValues, MediaDefinition, MediaField } from "./types";

const AGES = ["指定なし", "18歳", "20歳", "25歳", "30歳", "35歳", "40歳", "45歳", "50歳", "55歳", "60歳", "65歳", "70歳"] as const;
const CATEGORIES = [
  "イベント ＞ パーティー（交流会・飲み会・BBQなど）",
  "イベント ＞ セミナー（勉強会・キャリア・学びの会）",
  "イベント ＞ ワークショップ",
  "イベント ＞ スポーツ（バスケ・フットサルなど）",
  "イベント ＞ その他",
  "メンバー募集 ＞ 友達（日付のない、仲間集め）",
] as const;

const FIX_DATING: FixRule = { reason: "「出会い」を連想させる言葉（ジモティーでは避ける）", test: (l) => /出会い|恋活|婚活|合コン|恋人/.test(l) };

const fields: MediaField[] = [
  { key: "category", label: "カテゴリー", step: 0, kind: "select", options: CATEGORIES, required: true },
  { key: "prefecture", label: "地域（都道府県）", step: 0, kind: "text", required: true },
  { key: "city", label: "地域（市区郡）", step: 0, kind: "text", help: "市区郡か駅の、どちらかが必須です" },
  { key: "station", label: "地域（駅）", step: 0, kind: "text", help: "最寄り駅。市区郡か駅の、どちらかが必須です" },
  { key: "title", label: "タイトル", step: 1, kind: "text", required: true, max: 255, help: "一覧では先頭の30文字前後だけが見えます。日付と駅名を前に置いています" },
  { key: "body", label: "内容", step: 1, kind: "textarea", required: true, max: 15000, fixable: true, help: "最初に日時・場所・参加費を置いています。連絡先は書けません" },
  { key: "startAt", label: "開催日", step: 2, kind: "text", required: true, help: "例：2026-10-24 19:00" },
  { key: "endAt", label: "終了日", step: 2, kind: "text", help: "任意" },
  { key: "deadline", label: "募集期限", step: 2, kind: "text", help: "任意" },
  { key: "place", label: "開催場所", step: 2, kind: "text", help: "任意。お店の住所を出したくないときは空のままで投稿できます" },
  { key: "tel", label: "電話番号", step: 2, kind: "text", defaultable: true, help: "任意。本文には書けないので、この欄に入れます" },
  { key: "repeat", label: "連続投稿する場合はチェックしてください", step: 2, kind: "text", help: "毎週同じ曜日に開くときだけ（重複投稿は禁止）" },
  { key: "gender", label: "性別（メンバー募集）", step: 3, kind: "select", options: ["設定しない", "同性限定"] },
  { key: "ageMin", label: "年齢（下限）（メンバー募集）", step: 3, kind: "select", options: AGES },
  { key: "ageMax", label: "年齢（上限）（メンバー募集）", step: 3, kind: "select", options: AGES },
];

/**
 * タイトルの形（日付と駅を前に、「〜しませんか？」と絵文字）。
 * @param src - 材料
 * @returns 3つの案
 */
function titles(src: ListingSource): string[] {
  const date = shortDateOf(src);
  const st = stationName(src.event);
  const hour = src.event ? `${Number(src.event.startAt.slice(11, 13))}時` : "";
  const base = src.title.trim();
  return [
    `${date ? `【${date}】` : ""}${st ? `${st}で` : ""}${base}しませんか？🍻`,
    `${st ? `${st}で` : ""}${base}しませんか？🍻${date ? `（${date}）` : ""}`,
    `${date ? `【${date}${hour}】` : ""}${base}｜初参加歓迎`,
  ];
}

/**
 * ジモティーの欄を組み立てる。
 * @param src - 材料
 * @returns 欄の値・理由・タイトルの案
 */
function build(src: ListingSource): BuiltValues {
  const e = src.event;
  const t = titles(src);
  const kind = eventKind(src);
  const category =
    kind === "seminar" ? CATEGORIES[1] : kind === "workshop" ? CATEGORIES[2] : kind === "sports" ? CATEGORIES[3] : kind === "party" ? CATEGORIES[0] : CATEGORIES[4];
  const head = e ? [`【日時】${formatEventWhen(e)}`, `【場所】${formatEventPlace(e)}`, `【参加費】${formatEventFee(e) || "（入れてください）"}`] : [];
  const cancel = e?.cancelPolicy ? ["", "■キャンセルについて", e.cancelPolicy] : [];
  const body = [...head, "", contentOf(src), ...cancel].join("\n").trim();
  return {
    fields: {
      category,
      prefecture: e?.prefecture ?? "",
      city: "",
      station: stationName(e) ? `${stationName(e)}駅` : "",
      title: t[0]!,
      // 案内のURLは、自動の直しのあとに最後へ足す（finalize）
      body,
      startAt: spacedDateTime(e?.startAt),
      endAt: spacedDateTime(e?.endAt),
      deadline: "",
      place: e ? formatEventAddress(e) : "",
      tel: src.defaults.tel ?? "",
      repeat: "",
      gender: "設定しない",
      ageMin: "指定なし",
      ageMax: "指定なし",
    },
    reasons: {
      category: "イベントの内容から、目安を選んでいます。日時のある会は「イベント」、日付のない仲間集めは「メンバー募集 ＞ 友達」です",
      gender: "「設定しない」が初期値です",
    },
    titleCandidates: t.slice(1),
  };
}

/**
 * ジモティーのルール（共通のもののほかに）。
 * @returns 項目
 */
function rules(): ListingCheck[] {
  return [
    { level: "info", message: "同じ内容の投稿を、何度も出したり再掲載したりすることは禁止です（重複投稿）。毎週・毎月の開催は「連続投稿」を使います" },
    { level: "info", message: "投稿には運営の審査があります（1〜2時間が目安）" },
    { level: "info", message: "画像は500×500ピクセル・2MB以内です。一覧では正方形で表示されます" },
    { level: "info", message: "本文に連絡先（LINE・メール・電話番号）は書けません。質問は、ジモティー内のメッセージで受けます" },
  ];
}

/**
 * 自動の直しのあとに、「詳細・お申し込み」として専用URLを最後の1か所に足す。
 * @param values - 直したあとの欄の値
 * @param src - 材料
 * @returns 足したあとの値
 */
function finalize(values: ListingValues, src: ListingSource): ListingValues {
  if (!src.linkedUrl || (values.body ?? "").includes(src.linkedUrl)) return values;
  return { ...values, body: `${values.body ?? ""}\n\n■詳細・お申し込み\n${src.linkedUrl}`.trim() };
}

/** ジモティーの決まり。 */
export const JMTY: MediaDefinition = {
  media: "jmty",
  steps: ["① カテゴリー・地域", "② タイトル・内容", "③ 開催日・場所・画像", "④ メンバー募集（友達）にするときだけ"],
  fields,
  fixRules: [FIX_URL, FIX_LINE, FIX_EMAIL, FIX_PHONE, FIX_BANK, FIX_DATING],
  build,
  finalize,
  rules,
  workSteps: [
    { title: "ルールの確認", instruction: "上の「ルールのチェック」に、赤い項目がないことを確かめます", ruleCheck: true },
    { title: "「投稿」→ カテゴリーを選ぶ", instruction: "「投稿画面へ（無料）」を押し、カテゴリー「イベント」から選びます。地域は、市区郡か駅のどちらかが必須です", fields: ["category", "prefecture", "city", "station"] },
    { title: "タイトル", fields: ["title"] },
    { title: "内容", fields: ["body"] },
    { title: "画像（1枚目は正方形）", instruction: "画像生成AIにプロンプトを貼って作ります（500×500）", image: true },
    { title: "開催日・場所", fields: ["startAt", "endAt", "deadline", "place", "tel", "repeat"] },
    { title: "メンバー募集にするときだけ", instruction: "「メンバー募集 ＞ 友達」のときだけ入れます", fields: ["gender", "ageMin", "ageMax"] },
    { title: "「掲載する」を押す", publish: true },
  ],
  publishNotes: ["同じ内容を何度も出さないでください（重複投稿は禁止）"],
  image: {
    size: "正方形 1:1（500×500px、2MB以内）",
    layout: "一覧は正方形のサムネイル。文字や顔は、中央80%の中に入れる",
    trend: "大きな文字（見出し・日付・参加費）と、料理のアップ",
    avoid: ["「出会い」「恋活」「合コン」の言葉、ハート、男女2人きりの構図"],
  },
  polishGuide: ["タイトルは、日付と駅名を前に置き、「〜しませんか？」の呼びかけと絵文字（一覧で見えるのは30文字前後）", "内容の最初に、日時・場所・参加費", "連絡先（LINE・メール・電話番号）と、「出会い」を連想させる言葉は書かない"],
};

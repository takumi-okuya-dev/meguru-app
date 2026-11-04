// Peatix（specs/021-external-media contracts/media.md「Peatix」）。Peatix以外での申込・取引への誘導と、口座の行を外す。
import { formatEventAddress, formatEventFee, formatEventPlace } from "../promotion-event";
import { FIX_BANK, FIX_EMAIL, FIX_LINE, FIX_URL, clip, contentOf, dateFields, eventBlock, shortDateOf, stationName } from "./common";
import type { BuiltValues, ListingCheck, ListingSource, ListingValues, MediaDefinition, MediaField } from "./types";

const TITLE_MAX = 45;

const fields: MediaField[] = [
  { key: "group", label: "グループ（イベントを作る前に必要）", step: 0, kind: "text", defaultable: true, help: "港のグループを使います。まだなければ、先に作ります" },
  { key: "title", label: "イベント名", step: 0, kind: "text", required: true, max: TITLE_MAX, help: "45文字以内が、スマホで切れにくい目安です。日付を先頭に置く形にしています" },
  { key: "cadence", label: "開催形式", step: 0, kind: "select", options: ["単発開催", "定期開催（毎週・毎月など）"], required: true },
  { key: "format", label: "会場開催／オンライン", step: 0, kind: "select", options: ["会場開催", "オンライン"], required: true },
  { key: "startDate", label: "開催日時（開始・日付）", step: 0, kind: "text", required: true },
  { key: "startTime", label: "開催日時（開始・時間）", step: 0, kind: "text", required: true },
  { key: "endDate", label: "開催日時（終了・日付）", step: 0, kind: "text", required: true },
  { key: "endTime", label: "開催日時（終了・時間）", step: 0, kind: "text", required: true },
  { key: "venueName", label: "会場名", step: 1, kind: "text", required: true, help: "会場名を入れると候補が出ます。選ぶと住所と地図が入ります" },
  { key: "address", label: "（参考）会場の住所", step: 1, kind: "text" },
  { key: "categories", label: "カテゴリー・サブカテゴリー", step: 2, kind: "text", help: "サブカテゴリーは5つまで。メインのカテゴリーは、Peatixの画面で選んでください" },
  { key: "body", label: "イベントの詳細", step: 2, kind: "textarea", required: true, fixable: true, help: "冒頭の100〜200文字で、魅力と対象が伝わる順にしています" },
  { key: "paymentStyle", label: "チケットの種類・支払方法", step: 3, kind: "select", options: ["当日払い（無料チケット＋チケット名に金額・手数料なし）", "事前決済（有料チケット・手数料 4.9%＋99円／枚）"] },
  { key: "ticketName", label: "チケット名", step: 3, kind: "text", required: true, help: "チケット名に、金額と区分を入れると迷われません" },
  { key: "price", label: "金額（税込）", step: 3, kind: "text", help: "数字だけ。当日払い・無料のときは0" },
  { key: "ticketCount", label: "販売予定枚数", step: 3, kind: "text", required: true },
  { key: "cancelNote", label: "キャンセルについて（イベント詳細に書く）", step: 3, kind: "textarea" },
  { key: "privacy", label: "プライバシー設定", step: 4, kind: "select", options: ["一般公開（検索結果にも出る）", "限定公開（URLを知っている人だけ）", "パスワード保護"] },
  { key: "emergencyTel", label: "緊急連絡用電話番号", step: 4, kind: "text", required: true, defaultable: true, help: "数字とハイフンだけ" },
  { key: "form", label: "フォーム", step: 4, kind: "textarea", help: "任意。個人情報を聞くときは、目的を説明します" },
  { key: "slug", label: "イベントURL", step: 4, kind: "text", help: "英数字とハイフン" },
];

/**
 * イベント名の形（日付を先頭に。例：【11/25(水)20時〜】タイトル｜御徒町）。
 * @param src - 材料
 * @returns 3つの案（1つめが既定）
 */
function titles(src: ListingSource): string[] {
  const date = shortDateOf(src);
  const hour = src.event ? `${Number(src.event.startAt.slice(11, 13))}時〜` : "";
  const st = stationName(src.event);
  const base = src.title.trim();
  return [
    clip(`${date ? `【${date}${hour}】` : ""}${base}${st ? `｜${st}` : ""}`, TITLE_MAX),
    clip(`${base}${st ? `【${st}・初参加歓迎】` : "【初参加歓迎】"}`, TITLE_MAX),
    clip(`${st ? `【${st}】` : ""}初参加歓迎・一人参加OK ${base}${date ? `（${date}）` : ""}`, TITLE_MAX),
  ];
}

/**
 * Peatixの欄を組み立てる。
 * @param src - 材料
 * @returns 欄の値・理由・タイトルの案
 */
function build(src: ListingSource): BuiltValues {
  const e = src.event;
  const t = titles(src);
  const free = e?.feeYen === 0;
  const fee = e ? formatEventFee(e) : "";
  const body = [contentOf(src), "", ...eventBlock(src, { cancel: false })].join("\n").trim();
  return {
    fields: {
      group: src.defaults.group ?? "",
      title: t[0]!,
      cadence: "単発開催",
      format: e?.format === "online" ? "オンライン" : "会場開催",
      ...dateFields(e),
      venueName: e?.venueName ?? "",
      address: e ? formatEventAddress(e) : "",
      categories: "友だちづくり、コミュニティ、コミュニケーション",
      body,
      paymentStyle: "当日払い（無料チケット＋チケット名に金額・手数料なし）",
      ticketName: free ? "参加無料" : fee ? `参加費 ${fee}（当日払い）` : "参加費（当日払い）",
      price: "0",
      ticketCount: e?.capacity ? String(e.capacity) : "",
      cancelNote: e?.cancelPolicy ? `【キャンセルについて】\n${e.cancelPolicy}` : "",
      privacy: "一般公開（検索結果にも出る）",
      emergencyTel: src.defaults.emergencyTel ?? "",
      form: "",
      slug: "",
    },
    reasons: {
      cadence: "1回の開催なので「単発開催」です",
      format: e?.format === "online" ? "オンラインで開くので「オンライン」です" : "会場で開くので「会場開催」です",
      paymentStyle: "当日払いは手数料がかかりません。無料チケットとして作り、チケット名に金額を書きます",
      privacy: "広く見つけてもらうため「一般公開」です",
      venueName: e ? `「${formatEventPlace(e)}」の会場名を、Peatixの候補から選んでください` : "",
    },
    titleCandidates: t.slice(1),
  };
}

/**
 * Peatixのルール（共通のもののほかに）。
 * @param values - 欄の値
 * @returns 項目
 */
function rules(values: ListingValues): ListingCheck[] {
  const out: ListingCheck[] = [];
  if ([...(values.body ?? "")].length < 100) out.push({ level: "info", field: "body", message: "説明文の冒頭が短めです。冒頭の100〜200文字で、魅力と対象が伝わるようにすると、続きを読んでもらいやすくなります" });
  out.push(
    { level: "info", message: "当日払いのチケットは手数料がかかりません。無料チケットとして作るので、Peatix上には金額が出ません（チケット名に金額を書きます）" },
    { level: "info", message: "カバー画像は必須です（1840×900px、JPEG・PNG・GIF。詳細の画像と合わせて1回の保存で5MBまで）" },
    { level: "info", message: "イベントは、必ず「グループ」のもとで作ります。グループを作ってから「イベントを作成」を押します" },
  );
  return out;
}

/** Peatixの決まり。 */
export const PEATIX: MediaDefinition = {
  media: "peatix",
  steps: ["ステップ1｜基本情報", "ステップ2｜会場", "ステップ3｜詳細", "ステップ4｜チケット", "ステップ5｜設定・フォーム"],
  fields,
  fixRules: [FIX_URL, FIX_LINE, FIX_EMAIL, FIX_BANK],
  build,
  rules,
  workSteps: [
    { title: "ルールの確認", instruction: "上の「ルールのチェック」に、赤い項目がないことを確かめます", ruleCheck: true },
    { title: "グループを選んで「イベントを作成」", instruction: "港のグループを開いて、「イベントを作成」を押します", fields: ["group"] },
    { title: "ステップ1｜基本情報", instruction: "イベント名・単発/定期・会場開催/オンライン・日時を入れます", fields: ["title", "cadence", "format", "startDate", "startTime", "endDate", "endTime"] },
    { title: "ステップ2｜会場", instruction: "会場名を入れると候補が出ます。選ぶと住所と地図が入ります", fields: ["venueName", "address"] },
    { title: "ステップ3｜カバー画像", instruction: "画像生成AIにプロンプトを貼って作り、Peatixの画像欄に上げます（1840×900px）", image: true },
    { title: "ステップ3｜カテゴリー・イベントの詳細", fields: ["categories", "body"] },
    { title: "ステップ4｜チケット", instruction: "当日払いは、無料チケットを作り、チケット名に金額と「当日払い」を書きます", fields: ["paymentStyle", "ticketName", "price", "ticketCount"] },
    { title: "キャンセルのルール", instruction: "イベントの詳細の最後に入れます", fields: ["cancelNote"] },
    { title: "ステップ5｜設定・フォーム", fields: ["privacy", "emergencyTel", "form", "slug"] },
    { title: "公開する", publish: true },
  ],
  publishNotes: ["Peatixの文章には、Peatix以外での申込・取引へのURLを載せません"],
  image: {
    size: "1840×900px（横長 約2:1）、JPEG・PNG・GIF、5MBまで",
    layout: "大見出し・日付（曜日つき）・会場・参加費まで、画像に入れる",
    trend: "友達づくり・飲み会はあたたかいイラスト、ビジネス系は紺・金などのはっきりした色",
    avoid: [],
  },
  polishGuide: ["イベント名は45文字以内（日付を先頭に置く形が多い）", "詳細は、冒頭の100〜200文字で魅力と対象が伝わる順（紹介 → 対象 → 得られること → 流れ → 概要）", "Peatix以外での申込・取引に誘導するURL・口座・LINEは書かない"],
};

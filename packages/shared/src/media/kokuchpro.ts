// こくちーずプロ（specs/021-external-media contracts/media.md「こくちーずプロ」）。自動の直しはしない（港と同じ）。
import { PREFECTURES } from "../promotion-event";
import { clip, contentOf, dateFields, eventBlock, eventKind } from "./common";
import type { BuiltValues, ListingCheck, ListingSource, MediaDefinition, MediaField } from "./types";

const GENRES = [
  "テクノロジー／開発", "IT／インターネット", "デザイン／アート", "営業／販売", "マーケティング／広告",
  "コーチング／カウンセリング", "ビジネススキル／自己啓発", "人脈／交流会", "経営／起業", "ファイナンス／お金",
  "財務／会計", "法務／契約書", "知的財産／特許", "総務／人事", "社会／コミュニティ", "就職／求人",
  "キャリア／副業", "趣味／ライフスタイル", "家事／暮らし", "福祉／医療／介護", "展示会／シンポジウム",
  "音楽／舞台", "文化芸能／芸術", "スポーツ／格闘技", "ファッション／美容健康", "英語／語学", "料理／グルメ",
  "心理学／スピリチュアル", "育児／キッズ", "ヨガ／フィットネス", "ゲーム／eスポーツ", "プログラミング／言語",
  "モバイル／OS", "SNS／ブログマーケティング", "先端技術", "教育／授業づくり", "その他",
] as const;

const SUB_GENRES = [
  "（選ばない／こくちーず側の選択肢から選ぶ）", "異業種交流会", "勉強会", "地域交流", "婚活・街コン",
  "ダイバーシティ・多様性", "朝活", "カフェ会", "女子会", "食事会・食べ歩き", "国際交流会", "ビジネス交流会",
  "ITエンジニア交流会", "経営者交流会", "人狼ゲーム", "ボードゲーム", "読書会", "スポーツ観戦",
  "お花見・バーベキュー", "その他人脈",
] as const;

const CHECK = ["チェックする", "チェックしない"] as const;

const fields: MediaField[] = [
  { key: "format", label: "イベント形態", step: 0, kind: "select", options: ["オフライン", "オンライン", "オンデマンド"], required: true, immutable: true },
  { key: "pricing", label: "料金制度", step: 0, kind: "select", options: ["無料", "有料"], required: true, immutable: true },
  { key: "title", label: "イベント名", step: 1, kind: "text", required: true, max: 100, help: "港の正式名とは別に、こくちーず用に整えられます" },
  { key: "summary", label: "概要", step: 1, kind: "textarea", required: true, max: 80, help: "一覧に出る短い紹介文です" },
  { key: "genre", label: "ジャンル", step: 1, kind: "select", options: GENRES, required: true },
  { key: "subGenre", label: "ジャンル（2つ目の選択欄）", step: 1, kind: "select", options: SUB_GENRES, help: "選択肢は「人脈／交流会」のものです。ほかのジャンルのときは、こくちーずの画面の選択肢から選びます" },
  { key: "tags", label: "タグ", step: 1, kind: "text", help: "任意（空欄でもOK）" },
  { key: "body", label: "イベント内容（本文）", step: 1, kind: "textarea", required: true, help: "足りない内容は、ここで書き足してください" },
  { key: "venueName", label: "会場名", step: 2, kind: "text", required: true },
  { key: "venueUrl", label: "会場のURL", step: 2, kind: "text", help: "任意（空欄でもOK）" },
  { key: "country", label: "国", step: 2, kind: "select", options: ["日本"], required: true },
  { key: "prefecture", label: "都道府県", step: 2, kind: "select", options: PREFECTURES, required: true },
  { key: "address", label: "市区町村・番地", step: 2, kind: "text", required: true },
  { key: "building", label: "ビル名・階数", step: 2, kind: "text" },
  { key: "showMap", label: "地図を表示する（チェック）", step: 2, kind: "select", options: CHECK },
  { key: "officeName", label: "事務局名", step: 2, kind: "text", required: true, defaultable: true },
  { key: "officeTel", label: "連絡先TEL", step: 2, kind: "text", required: true, defaultable: true },
  { key: "officeEmail", label: "事務局メールアドレス", step: 2, kind: "text", required: true, defaultable: true },
  { key: "group", label: "主催グループ", step: 2, kind: "text", required: true, defaultable: true },
  { key: "customUrl", label: "カスタムURL", step: 2, kind: "text", help: "任意（空欄でもOK）" },
  { key: "visibility", label: "公開モード", step: 3, kind: "select", options: ["一般公開", "限定公開", "パスワード制限", "主催者専用", "グループメンバー専用", "グループスタッフ専用"], required: true },
  { key: "reception", label: "受付タイプ", step: 3, kind: "select", options: ["こくちーずプロ受付", "外部サイト受付", "オフライン受付", "オープンイベント(受付なし)"], required: true },
  { key: "applyUrl", label: "申込ページURL", step: 3, kind: "text", help: "「外部サイト受付」を選んだときだけ入れます" },
  { key: "waitlist", label: "キャンセル待ちを受付ける（チェック）", step: 3, kind: "select", options: CHECK },
  { key: "attendRequired", label: "イベント参加必須（チェック）", step: 3, kind: "select", options: CHECK, required: true },
  { key: "maxPerApply", label: "同時申込最大数", step: 3, kind: "text", required: true },
  { key: "showCount", label: "申込数表示", step: 3, kind: "select", options: ["表示しない", "申込数表示", "残席数表示"] },
  { key: "unit", label: "人数表記", step: 3, kind: "select", options: ["人", "チーム", "団体", "組", "グループ"] },
  { key: "showApplicants", label: "申込者リスト", step: 3, kind: "select", options: ["表示しない", "表示する", "表示する（チケット名・申込日も含める）"] },
  { key: "ticketPrint", label: "チケット印刷", step: 3, kind: "select", options: ["不可", "申込後に可能", "入金確認後に可能"] },
  { key: "priority", label: "募集中優先表示", step: 3, kind: "select", options: ["なし", "募集中の開催日を優先表示"] },
  { key: "cancelLimit", label: "キャンセル受付期限", step: 3, kind: "select", options: ["開催日までキャンセル可", "募集期間内のみキャンセル可", "キャンセル不可（個別対応）"] },
  { key: "cancelNote", label: "キャンセル・払い戻しについての特記事項", step: 3, kind: "textarea" },
  { key: "startDate", label: "開催日時（開始・日付）", step: 4, kind: "text", required: true, help: "例：2026-10-24" },
  { key: "startTime", label: "開催日時（開始・時間）", step: 4, kind: "text", required: true, help: "例：19:00" },
  { key: "endDate", label: "開催日時（終了・日付）", step: 4, kind: "text", required: true },
  { key: "endTime", label: "開催日時（終了・時間）", step: 4, kind: "text", required: true },
  { key: "capacity", label: "定員", step: 4, kind: "text", help: "数字だけ。無制限のときは空欄" },
  { key: "ticketName", label: "チケット名", step: 5, kind: "text", required: true },
  { key: "price", label: "金額（税込）", step: 5, kind: "text", required: true, help: "数字だけ（円）" },
  { key: "ticketCount", label: "販売枚数", step: 5, kind: "text", help: "数字だけ" },
  { key: "payment", label: "支払方法設定", step: 6, kind: "select", options: ["設定しない（無料イベント）", "個別支払（振込先などを自分で案内する）", "こくちーず決済：クレジットカード", "こくちーず決済：クレジットカード／コンビニ／ATM"] },
  { key: "paymentNote", label: "個別支払設定の案内文", step: 6, kind: "textarea", help: "口座・PayPay IDは入れません。振込先は、ご本人がこくちーず側で入れてください" },
];

/**
 * こくちーずプロの欄を組み立てる。
 * @param src - 材料
 * @returns 欄の値・理由・タイトルの案
 */
function build(src: ListingSource): BuiltValues {
  const e = src.event;
  const d = dateFields(e);
  const kind = eventKind(src);
  const isFree = e?.feeYen === 0;
  const genre = kind === "party" ? "人脈／交流会" : kind === "seminar" ? "ビジネススキル／自己啓発" : kind === "sports" ? "スポーツ／格闘技" : "その他";
  const it = /IT|エンジニア|テック/.test(`${src.title}${src.content}`);
  const sub = genre !== "人脈／交流会" ? SUB_GENRES[0] : it ? "ITエンジニア交流会" : /ボドゲ|ボードゲーム/.test(src.content) ? "ボードゲーム" : "異業種交流会";
  const first = contentOf(src).split("\n").find((l) => l.trim() !== "") ?? src.title;
  const body = ["■このイベントについて", contentOf(src), "", ...eventBlock(src)].join("\n").trim();
  const f: Record<string, string> = {
    format: e?.format === "online" ? "オンライン" : "オフライン",
    pricing: isFree ? "無料" : "有料",
    title: clip(src.title, 100),
    summary: clip(first, 80),
    genre,
    subGenre: sub,
    tags: "",
    body,
    venueName: e?.venueName ?? "",
    venueUrl: "",
    country: "日本",
    prefecture: e?.prefecture ?? "",
    address: e?.address ?? "",
    building: e?.building ?? "",
    showMap: "チェックしない",
    officeName: src.defaults.officeName ?? "",
    officeTel: src.defaults.officeTel ?? "",
    officeEmail: src.defaults.officeEmail ?? "",
    group: src.defaults.group ?? "",
    customUrl: "",
    visibility: "一般公開",
    reception: "こくちーずプロ受付",
    applyUrl: src.linkedUrl,
    waitlist: "チェックしない",
    attendRequired: "チェックする",
    maxPerApply: "1",
    showCount: "申込数表示",
    unit: "人",
    showApplicants: "表示しない",
    ticketPrint: "申込後に可能",
    priority: "なし",
    cancelLimit: "開催日までキャンセル可",
    cancelNote: e?.cancelPolicy ?? "",
    ...d,
    capacity: e?.capacity ? String(e.capacity) : "",
    ticketName: "参加費",
    price: e?.feeYen != null ? String(e.feeYen) : "",
    ticketCount: e?.capacity ? String(e.capacity) : "",
    payment: isFree ? "設定しない（無料イベント）" : "個別支払（振込先などを自分で案内する）",
    paymentNote: isFree ? "" : "お支払い方法・期限は、お申し込み後にご案内します。",
  };
  return {
    fields: f,
    reasons: {
      format: e?.format === "online" ? "オンラインで開くので「オンライン」です" : "会場で開催するので「オフライン」です",
      pricing: isFree ? "参加費が無料なので「無料」です" : "参加費があるので「有料」です",
      genre: "イベントの内容から、目安を選んでいます。違うときは変えてください",
      subGenre: "ジャンルを選ぶと、こくちーず側でサブジャンルの選択肢が出ます",
      showApplicants: "参加者の名前を公開しないよう、「表示しない」です",
      payment: isFree ? "無料のイベントです" : "振込先などの案内は、こくちーず側でご本人が入れてください",
    },
    titleCandidates: [],
  };
}

/**
 * こくちーずプロのルール（共通のもののほかに）。
 * @returns 項目
 */
function rules(): ListingCheck[] {
  return [{ level: "info", message: "1日に登録できるのは3件までです（プレミアム会員は20件）" }];
}

/** こくちーずプロの決まり。 */
export const KOKUCHPRO: MediaDefinition = {
  media: "kokuchpro",
  steps: ["① 登録の最初に選ぶ項目", "② 基本情報", "③ 会場・事務局", "④ 公開・受付の設定", "⑤ 開催日・定員", "⑥ チケット（参加費）", "⑦ 支払い方法"],
  fields,
  fixRules: [],
  build,
  rules,
  workSteps: [
    { title: "登録の最初の画面で、2つを選ぶ", instruction: "「こくちーずプロ」→「イベント登録」を開いて、イベント形態と料金制度を選び、「次へ」を押します（登録後は変更できません）", fields: ["format", "pricing"] },
    { title: "イベント名", fields: ["title"] },
    { title: "概要", fields: ["summary"] },
    { title: "ジャンルを選ぶ", instruction: "ジャンルを選んでから、サブジャンルを選びます", fields: ["genre", "subGenre"] },
    { title: "タグ（任意）", fields: ["tags"] },
    { title: "イベント画像", instruction: "画像生成AIにプロンプトを貼って作り、こくちーずプロの画像欄に上げます", image: true },
    { title: "イベント内容（本文）", fields: ["body"] },
    { title: "会場", fields: ["venueName", "venueUrl", "country", "prefecture", "address", "building", "showMap"] },
    { title: "事務局・主催", fields: ["officeName", "officeTel", "officeEmail", "group", "customUrl"] },
    { title: "公開・受付の設定", fields: ["visibility", "reception", "applyUrl", "waitlist", "attendRequired", "maxPerApply", "showCount", "unit", "showApplicants", "ticketPrint", "priority", "cancelLimit", "cancelNote"] },
    { title: "開催日時・定員", fields: ["startDate", "startTime", "endDate", "endTime", "capacity"] },
    { title: "チケット（参加費）", instruction: "「イベントチケット」を、料金に合わせて作ります", fields: ["ticketName", "price", "ticketCount"] },
    { title: "登録する → 支払方法を設定する", instruction: "登録を終えたあと、「支払方法設定」→「個別支払設定」で設定します。振込先などは、ご本人が入れてください", fields: ["payment", "paymentNote"] },
    { title: "申込先のURL（説明文に入れる）", fields: ["applyUrl"] },
    { title: "ルールの確認 → 最終確認 → 公開", instruction: "上の「ルールのチェック」を確かめ、入れた内容を見直して「公開する」を押します", ruleCheck: true, publish: true },
  ],
  publishNotes: ["1日に登録できるのは、3件までです（プレミアム会員は20件）"],
  image: {
    size: "横長 4:3（1320×990px相当）",
    layout: "一覧では中央が約135px角の正方形に切られる。見出し・バッジ・人物・主な小物は、中央の横幅75%に収め、左右12.5%は背景だけにする",
    trend: "短い大きな見出しと、何をする会かが分かるシーン",
    avoid: [],
  },
  polishGuide: ["イベント名は100文字まで", "概要は80文字まで（一覧に出る短い紹介文）", "本文は「■」の見出しで、日時・場所・参加費を分かりやすく"],
};

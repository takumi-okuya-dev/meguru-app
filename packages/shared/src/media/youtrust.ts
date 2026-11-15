// YOUTRUST（specs/021-external-media contracts/media.md「YOUTRUST」）。仕事・キャリアでつながる場なので、参加が限られて見える表現・
// 出会い目的の言葉・他サイトのURL・誇大な表現の行を外す。
import { formatEventAddress, formatEventFee, formatEventPlace, formatEventWhen } from "../promotion-event";
import { FIX_BANK, FIX_LINE, FIX_URL, contentOf, dateFields, stationName } from "./common";
import type { BuiltValues, FixRule, ListingCheck, ListingSource, ListingValues, MediaDefinition, MediaField } from "./types";

const FIX_EXCLUSIVE: FixRule = { reason: "完全紹介制・会員限定など、参加が限られて見える表現（YOUTRUSTは広く参加できる会が前提）", test: (l) => /完全紹介|会員制|会員限定|紹介制/.test(l) };
const FIX_DATING: FixRule = { reason: "出会い目的の言葉（仕事・キャリアの場に合わない）", test: (l) => /出会い|恋活|婚活|合コン|恋バナ|猥談/.test(l) };
const FIX_HYPE: FixRule = { reason: "誇大な表現（禁止）", test: (l) => /必ず(稼|儲)|絶対に|100%|１００％/.test(l) };

// 絵文字（記号の飾りを含む）
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

const fields: MediaField[] = [
  { key: "title", label: "タイトル", step: 0, kind: "text", required: true, help: "絵文字を外して簡潔にしています。「＠エリア」を付けた形が多く見られます" },
  { key: "audience", label: "このような方におすすめ（対象者）", step: 0, kind: "textarea", help: "任意。対象の職種・どんな人向けかを箇条書きで入れます" },
  { key: "summary", label: "概要", step: 0, kind: "textarea", required: true, fixable: true, help: "日時・場所・参加費と、仕事やキャリアにどうつながるかの一言を入れると、趣旨に合います" },
  { key: "format", label: "会場・配信", step: 1, kind: "select", options: ["オフライン（会場に集まる）", "オンライン（配信で参加）", "ハイブリッド（両方）"], required: true },
  { key: "startDate", label: "日程（開始・日付）", step: 1, kind: "text" },
  { key: "startTime", label: "日程（開始・時間）", step: 1, kind: "text" },
  { key: "endDate", label: "日程（終了・日付）", step: 1, kind: "text" },
  { key: "endTime", label: "日程（終了・時間）", step: 1, kind: "text" },
  { key: "venueName", label: "会場名（オフライン・ハイブリッド）", step: 1, kind: "text", help: "会場名だけに整えてください" },
  { key: "address", label: "住所（オフライン・ハイブリッド）", step: 1, kind: "text", help: "イベントページに表示されます。階・部屋番号は任意" },
  { key: "host", label: "主催", step: 2, kind: "text", required: true, defaultable: true, help: "YOUTRUSTに登録されている、あなたが所属するカンパニー" },
  { key: "operator", label: "運営者", step: 2, kind: "text", defaultable: true, help: "任意。主催カンパニーに属するユーザー" },
  { key: "coHosts", label: "共同主催", step: 2, kind: "text", help: "最大4社まで" },
  { key: "speakers", label: "登壇者紹介", step: 2, kind: "textarea", help: "名前・写真を載せるときは、必ずご本人の許諾を得てください" },
  { key: "timetable", label: "タイムテーブル", step: 2, kind: "textarea", help: "時刻つきの流れがあるときだけ" },
  { key: "sales", label: "チケット（販売方法）", step: 3, kind: "select", options: ["先着（申込順に受け付け、定員で締め切り）", "抽選（申込期間のあと、まとめて抽選）"], required: true },
  { key: "ticketName", label: "チケット名", step: 3, kind: "text", required: true },
  { key: "price", label: "チケット（料金）", step: 3, kind: "text", help: "概要と同じ金額にしてください" },
  { key: "salesStart", label: "チケット（販売期間・開始）", step: 3, kind: "text", help: "空欄のときは、公開と同時に受付を始めます" },
  { key: "salesEnd", label: "チケット（販売期間・終了）", step: 3, kind: "text", help: "開始日時を入れています。前日までにしたいときは直してください" },
  { key: "capacity", label: "チケット（定員）", step: 3, kind: "text", help: "数字だけ。無制限のときは空欄" },
  { key: "survey", label: "アンケート", step: 4, kind: "textarea", help: "1行に1問。最大20問。個人情報を聞くときは目的を説明します" },
  { key: "contactEmail", label: "問い合わせメール", step: 4, kind: "text", required: true, defaultable: true },
];

/**
 * YOUTRUSTの欄を組み立てる。
 * @param src - 材料
 * @returns 欄の値・理由・タイトルの案
 */
function build(src: ListingSource): BuiltValues {
  const e = src.event;
  const st = stationName(e);
  const plain = src.title.replace(EMOJI_RE, "").replace(/【[^】]*】/g, "").replace(/｜港$/, "").trim();
  const title = st ? `${plain}＠${st}` : plain;
  const audience = e?.audience
    ? e.audience
        .split(/[／/、,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `・${s}`)
        .join("\n")
    : "";
  const head = e ? [`日時：${formatEventWhen(e)}`, `場所：${formatEventPlace(e)}`, `参加費：${formatEventFee(e) || "（入れてください）"}`] : [];
  const summary = [contentOf(src), "", ...head].join("\n").trim();
  const d = dateFields(e);
  return {
    fields: {
      title,
      audience,
      summary,
      format: e?.format === "online" ? "オンライン（配信で参加）" : "オフライン（会場に集まる）",
      ...d,
      venueName: e?.venueName ?? "",
      address: e ? formatEventAddress(e) : "",
      host: src.defaults.host ?? "",
      operator: src.defaults.operator ?? "",
      coHosts: "",
      speakers: "",
      timetable: "",
      sales: "先着（申込順に受け付け、定員で締め切り）",
      ticketName: "参加チケット",
      price: e?.feeYen != null ? String(e.feeYen) : "",
      salesStart: "",
      salesEnd: d.startDate ? `${d.startDate} ${d.startTime}` : "",
      capacity: e?.capacity ? String(e.capacity) : "",
      survey: "",
      contactEmail: src.defaults.contactEmail ?? "",
    },
    reasons: {
      format: e?.format === "online" ? "オンラインで開くので「オンライン」です" : "会場で開くので「オフライン」です",
      sales: "人気の会は抽選にもできます。申込が定員に届かなければ、申込者全員が当選になります",
    },
    titleCandidates: plain !== title ? [plain] : [],
  };
}

/**
 * YOUTRUSTのルール（共通のもののほかに）。
 * @param values - 欄の値
 * @returns 項目
 */
function rules(values: ListingValues): ListingCheck[] {
  const out: ListingCheck[] = [];
  const offline = !(values.format ?? "").startsWith("オンライン");
  if (offline && (values.address ?? "").trim() === "")
    out.push({ level: "yellow", field: "address", message: "住所が空です。オフラインのイベントは、住所と会場名の入力が必要です（住所はイベントページに表示されます）" });
  if (offline && (values.venueName ?? "").trim() === "") out.push({ level: "yellow", field: "venueName", message: "会場名が空です。オフラインのイベントでは必須です" });
  out.push(
    { level: "info", message: "サムネイル（必須）：1200×630px、5MB以下、png / jpg / jpeg / webp。ファイル名に日本語は使えません" },
    { level: "info", message: "主催は、公開したあとに個人主催とカンパニー主催を切り替えられません" },
    { level: "info", message: "一度公開すると、下書きには戻せません" },
    { level: "info", message: "公開すると、コミュニティのメンバーやフォロワーに通知が届きます。22時〜8時に公開すると、通知は翌朝8時以降になります" },
  );
  return out;
}

/** YOUTRUSTの決まり。 */
export const YOUTRUST: MediaDefinition = {
  media: "youtrust",
  steps: ["① 基本", "② 開催形式・日程・会場", "③ 主催・運営者・登壇者", "④ チケット", "⑤ アンケート・問い合わせ先"],
  fields,
  fixRules: [FIX_URL, FIX_LINE, FIX_BANK, FIX_EXCLUSIVE, FIX_DATING, FIX_HYPE],
  build,
  rules,
  workSteps: [
    { title: "ルールの確認", instruction: "上の「ルールのチェック」に、赤い項目がないことを確かめます", ruleCheck: true },
    { title: "イベントの作成を開く", instruction: "YOUTRUSTの「イベントの作成」を開きます" },
    { title: "タイトル", fields: ["title"] },
    { title: "サムネイル画像", instruction: "画像生成AIにプロンプトを貼って作ります（1200×630px、ファイル名は英数字）", image: true },
    { title: "このような方におすすめ → 概要", fields: ["audience", "summary"] },
    { title: "開催形式・日程", fields: ["format", "startDate", "startTime", "endDate", "endTime"] },
    { title: "会場（または配信URL）", fields: ["venueName", "address"] },
    { title: "主催・運営者・共同主催", fields: ["host", "operator", "coHosts"] },
    { title: "登壇者・タイムテーブル（ある場合）", fields: ["speakers", "timetable"] },
    { title: "チケット", fields: ["sales", "ticketName", "price", "salesStart", "salesEnd", "capacity"] },
    { title: "アンケート・問い合わせメール", fields: ["survey", "contactEmail"] },
    { title: "公開する", instruction: "公開前に、日時・会場・チケット・サムネイルを確かめます", publish: true },
  ],
  publishNotes: ["一度公開すると、下書きには戻せません", "22時〜8時に公開すると、通知は翌朝8時以降になります"],
  image: {
    size: "1200×630px（横長 1.91:1）、5MB以下",
    layout: "日時・会場・対象者・定員（参加費）・主催者名まで、画像に入れるものが多い",
    trend: "交流会・コミュニティはやさしいイラスト、セミナーは登壇者の顔写真と肩書き（本人の許諾があるものだけ）",
    avoid: ["詳細な住所"],
  },
  polishGuide: ["タイトルは絵文字を外し、「＠エリア」を付けた簡潔な形", "概要に、仕事やキャリアにどうつながるかの一言を入れる", "完全紹介制・会員制など参加が限られて見える表現、出会い目的の言葉、他サイトのURLは書かない"],
};

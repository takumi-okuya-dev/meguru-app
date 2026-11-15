// つなげーと（specs/021-external-media contracts/media.md「つなげーと」）。ルールが厳しいので、外へのURL・連絡先・紹介の特典・
// 男女で違う条件・人数の表記・現地払いの行を外す。集合場所には、地図のURLを載せてよい。
import { eventDateParts, formatEventFee, formatEventPlace, formatEventWhen } from "../promotion-event";
import { FIX_BANK, FIX_EMAIL, FIX_LINE, FIX_PHONE, FIX_URL, clip, contentOf, spacedDateTime, stationName } from "./common";
import type { BuiltValues, FixRule, ListingCheck, ListingSource, ListingValues, MediaDefinition, MediaField } from "./types";

const TITLE_MAX = 60;

const FIX_REFERRAL: FixRule = { reason: "紹介・招待の特典（つなげーとでは扱えない）", test: (l) => /紹介割|紹介した人|招待コード|友達紹介|お友達紹介|紹介特典/.test(l) };
const FIX_GENDER: FixRule = { reason: "男女で違う料金・条件（禁止）", test: (l) => /男性\s*[0-9０-９,，]+円|女性\s*[0-9０-９,，]+円|男女比|女性限定|男性限定|女性無料/.test(l) };
const FIX_HEADCOUNT: FixRule = { reason: "人数の表記（タイトル・紹介文には書けない）", test: (l) => /定員|[0-9０-９]+\s*名(限定|募集|まで)|[0-9０-９]+\s*人(限定|募集|まで)/.test(l) };
const FIX_CASH: FixRule = { reason: "現地払いの案内（つなげーとは事前決済のみ）", test: (l) => /当日(現金)?払い|現地払い|現金でお支払い/.test(l) };

const BUSINESS_RE = /人脈|ビジネス|副業|投資|稼ぐ|起業|営業|勧誘|情報交換/;

const fields: MediaField[] = [
  { key: "title", label: "イベント名", step: 0, kind: "text", required: true, max: TITLE_MAX, help: "エリア＋限定語＋内容＋絵文字・30字以上の形にしています。人数の表記は外しています" },
  { key: "intro", label: "紹介文", step: 0, kind: "textarea", required: true, fixable: true, help: "冒頭の3行に会場・日時・費用、そのあと楽しめるポイントの順です。600〜1,000文字が、上位に出やすい目安です" },
  { key: "startAt", label: "イベント日時（開始時刻）", step: 1, kind: "text", required: true, help: "例：2026-10-24 19:00" },
  { key: "endAt", label: "イベント日時（終了時刻）", step: 1, kind: "text", required: true },
  { key: "format", label: "リアル／オンライン", step: 1, kind: "select", options: ["リアル", "オンライン"], required: true },
  { key: "place", label: "場所", step: 1, kind: "text", required: true, help: "住所が書けなくても、最寄り駅などを必ず書きます。例：新宿駅西口" },
  { key: "ticketName", label: "チケット名", step: 2, kind: "text" },
  { key: "price", label: "参加料金", step: 2, kind: "text", help: "数字だけ（円）。500円以上。無料のときは0（チケットを作りません）" },
  { key: "ticketCapacity", label: "チケットの定員", step: 2, kind: "text", help: "任意。早割の枚数を決めたいときだけ" },
  { key: "payment", label: "決済方法", step: 2, kind: "select", options: ["事前決済（クレジット／Amazon Pay）"] },
  { key: "feePayer", label: "イベント参加手数料の課金対象", step: 2, kind: "select", options: ["参加者が負担（初期値）", "主催者（クリエイター）が負担"] },
  { key: "minPeople", label: "募集人数（最小人数）", step: 3, kind: "text", help: "任意。2から" },
  { key: "maxPeople", label: "募集人数（最大人数）", step: 3, kind: "text", help: "2〜100は1刻み、その先は200・300…です" },
  { key: "circle", label: "主催サークル", step: 3, kind: "text", required: true, defaultable: true },
  { key: "exclusive", label: "つなげーとの予約システム以外で、参加者を募集、または参加予定者がいない（チェック）", step: 3, kind: "select", options: ["チェックしない", "チェックする（つなげーとに集客を一本化）"] },
  { key: "genderRatio", label: "詳細設定：男女比調整", step: 4, kind: "select", options: ["設定しない"] },
  { key: "ageLimit", label: "詳細設定：年齢制限", step: 4, kind: "text", help: "任意。年代を限定する会のときだけ" },
  { key: "meetingPlace", label: "詳細設定：集合場所", step: 4, kind: "textarea", help: "お店の地図のURLは、載せてよいことになっています" },
  { key: "visibility", label: "詳細設定：公開範囲", step: 4, kind: "select", options: ["公開（初期値）", "限定公開"] },
  { key: "refundPolicy", label: "詳細設定：返金ポリシー", step: 4, kind: "textarea" },
  { key: "deadline", label: "詳細設定：申込締切", step: 4, kind: "text", help: "任意" },
  { key: "autoMessage", label: "詳細設定：自動送信メッセージ", step: 4, kind: "textarea", help: "申し込んだ人に自動で届きます。日時・場所を入れています" },
];

/**
 * イベント名の形（エリア＋限定語＋内容＋絵文字）。
 * @param src - 材料
 * @returns 3つの案
 */
function titles(src: ListingSource): string[] {
  const st = stationName(src.event);
  const base = src.title.trim().replace(/[0-9０-９]+\s*(名|人)(限定|募集)?/g, "").trim();
  return [
    clip(`${st ? `【${st}】` : ""}初参加歓迎・一人参加OK✨${base}🍻`, TITLE_MAX),
    clip(`${base}｜${st ? `${st}で` : ""}初参加歓迎（ゆるっと）🍻`, TITLE_MAX),
    clip(`🍻初参加歓迎！${st ? `${st}の` : ""}${base}`, TITLE_MAX),
  ];
}

/**
 * つなげーとの欄を組み立てる。
 * @param src - 材料
 * @returns 欄の値・理由・タイトルの案
 */
function build(src: ListingSource): BuiltValues {
  const e = src.event;
  const t = titles(src);
  const free = e?.feeYen === 0;
  const head = e
    ? [`📍場所：${formatEventPlace(e)}`, `🗓日時：${formatEventWhen(e)}`, `💰参加費：${free ? "無料" : `${formatEventFee(e)}（つなげーとでの事前決済）`}`]
    : [];
  const intro = [...head, "", "◆このイベントについて", contentOf(src)].join("\n").trim();
  return {
    fields: {
      title: t[0]!,
      intro,
      startAt: spacedDateTime(e?.startAt),
      endAt: spacedDateTime(e?.endAt),
      format: e?.format === "online" ? "オンライン" : "リアル",
      place: e?.station ?? e?.venueName ?? "",
      ticketName: free ? "" : "参加チケット",
      price: e?.feeYen != null ? String(e.feeYen) : "",
      ticketCapacity: "",
      payment: "事前決済（クレジット／Amazon Pay）",
      feePayer: "参加者が負担（初期値）",
      minPeople: "",
      maxPeople: e?.capacity ? String(e.capacity) : "",
      circle: src.defaults.circle ?? "",
      exclusive: "チェックしない",
      genderRatio: "設定しない",
      ageLimit: "",
      meetingPlace: e ? formatEventPlace(e) : "",
      visibility: "公開（初期値）",
      refundPolicy: e?.cancelPolicy ?? "",
      deadline: "",
      autoMessage: e
        ? [`お申し込みありがとうございます！当日お会いできるのを楽しみにしています😊`, "", `日時：${formatEventWhen(e)}`, `場所：${formatEventPlace(e)}`].join("\n")
        : "",
    },
    reasons: {
      format: e?.format === "online" ? "オンラインで開くので「オンライン」です" : "会場で開くので「リアル」です",
      payment: "つなげーとは事前決済のみです",
      feePayer: "参加者の負担が初期値です",
      exclusive: "ほかでも募集しているので、チェックしません",
      genderRatio: "男女で参加条件に差をつけることは、禁止です",
      visibility: "広く見つけてもらうため「公開」です",
    },
    titleCandidates: t.slice(1),
  };
}

/**
 * つなげーとのルール（共通のもののほかに）。
 * @param values - 欄の値
 * @param src - 材料
 * @returns 項目
 */
function rules(values: ListingValues, src: ListingSource): ListingCheck[] {
  const out: ListingCheck[] = [];
  const text = `${values.title ?? ""}\n${values.intro ?? ""}`;
  const word = BUSINESS_RE.exec(text);
  if (word) out.push({ level: "yellow", field: "intro", message: `ビジネス・お金・勧誘に関わる言葉があります（「${word[0]}」など）。つなげーとでは、ビジネス交流・金銭学習・勧誘が目的のイベントは掲載できません` });
  if ([...(values.title ?? "")].length < 30) out.push({ level: "info", field: "title", message: "イベント名は30字以上が、見つけてもらいやすい目安です" });
  const fee = src.event?.feeYen;
  if (fee && fee > 0) out.push({ level: "info", message: `手数料の目安：参加費${fee.toLocaleString("ja-JP")}円の場合、主催者の決済手数料は約${Math.round(fee * 0.08).toLocaleString("ja-JP")}円（8%）＋出金時の振込手数料330円。参加者には別に、つなげーと手数料500円がかかります` });
  if (fee !== undefined && fee !== null && fee > 0 && fee < 500) out.push({ level: "red", field: "price", message: "参加料金は500円以上です" });
  out.push(
    { level: "info", message: "公開したら、主催者（あなた）自身も、このイベントに参加申し込みをしてください（主催者の申し込みは3人まで手数料無料）" },
    { level: "info", message: "同じイベントのページを、複数作るのは禁止です" },
  );
  if (src.event) {
    const s = eventDateParts(src.event.startAt);
    const hour = Number(s.time.slice(0, 2));
    const popular = (s.weekday === "金" && hour >= 19 && hour <= 23) || (s.weekday === "土" && hour >= 15 && hour <= 20);
    if (!popular) out.push({ level: "info", message: "つなげーとで人気の時間は、金曜の19〜23時と、土曜の15〜20時です（変えられるなら、参考にしてください）" });
  }
  return out;
}

/** つなげーとの決まり。 */
export const TSUNAGATE: MediaDefinition = {
  media: "tsunagate",
  steps: ["① 基本", "② 日時・場所", "③ チケット（参加費）", "④ 募集人数・主催サークル", "⑤ 詳細設定"],
  fields,
  fixRules: [FIX_URL, FIX_LINE, FIX_EMAIL, FIX_PHONE, FIX_BANK, FIX_REFERRAL, FIX_GENDER, FIX_HEADCOUNT, FIX_CASH],
  build,
  rules,
  workSteps: [
    { title: "ルールの確認", instruction: "上の「ルールのチェック」に、赤い項目がないことを確かめます。つなげーとは掲載のルールが厳しい媒体です", ruleCheck: true },
    { title: "イベント名", fields: ["title"] },
    { title: "紹介文", instruction: "「紹介文」の欄に貼ります", fields: ["intro"] },
    { title: "写真（カバー画像）", instruction: "画像生成AIにプロンプトを貼って作り、カバーに上げます（4:3）", image: true },
    { title: "「次へ」→ 日時・場所", fields: ["startAt", "endAt", "format", "place"] },
    { title: "チケット（参加費）", fields: ["ticketName", "price", "ticketCapacity", "payment", "feePayer"] },
    { title: "募集人数・主催サークル", instruction: "「つなげーとの予約システム以外で…」のチェックは、入れません", fields: ["minPeople", "maxPeople", "circle", "exclusive"] },
    { title: "詳細設定を開いて入れる", instruction: "「詳細設定」をひらいて、必要な項目だけ入れます", fields: ["genderRatio", "ageLimit", "meetingPlace", "visibility", "refundPolicy", "deadline", "autoMessage"] },
    { title: "公開する → 自分も参加申し込み", publish: true },
  ],
  publishNotes: ["「公開する」を押したら、主催者（あなた）自身も、このイベントに参加申し込みをします（主催者の申し込みは3人まで手数料無料）", "同じイベントのページは、2つ作らないでください"],
  image: {
    size: "横縦 4:3（1600×1200px、最低1200×900px）",
    layout: "写真はカバーのほかに5枚まで（会場の外観・当日の流れ・料理や企画・過去の雰囲気）",
    trend: "あたたかい雰囲気で、何をする会かが分かるもの",
    avoid: ["人数・定員", "顔をぼかした写真・スタンプで隠した写真"],
  },
  polishGuide: ["イベント名は60文字まで、30字以上（エリア＋限定語＋内容＋絵文字）。人数は書かない", "紹介文は、冒頭の3行に会場・日時・費用。600〜1,000文字", "外部へのURL・連絡先・紹介の特典・男女で違う条件・現地払い・ビジネスや勧誘の言葉は書かない"],
};

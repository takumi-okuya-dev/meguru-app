// 宣伝内容の「イベントの情報」（specs/021-external-media data-model.md、spec FR-001）。
// 外部媒体展開の掲載内容と、宣伝投稿のプロンプトの1行に使う。日時は日本時間の「YYYY-MM-DDTHH:mm」で持つ。

/** 都道府県（こくちーずプロ・ジモティーの選択肢と同じ順）。 */
export const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

/** 会場かオンラインか。 */
export const EVENT_FORMATS = ["venue", "online"] as const;

/** イベントの情報（promotionEventSchema の型。schemas.ts）。 */
export type PromotionEvent = {
  startAt: string;
  endAt: string | null;
  format: (typeof EVENT_FORMATS)[number];
  venueName: string | null;
  prefecture: (typeof PREFECTURES)[number] | null;
  address: string | null;
  building: string | null;
  station: string | null;
  capacity: number | null;
  feeYen: number | null;
  feeNote: string | null;
  cancelPolicy: string | null;
  audience: string | null;
  organizer: string | null;
};

const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 「YYYY-MM-DDTHH:mm」として正しい日時か。
 * @param s - 文字列
 * @returns 正しければ true
 */
export function isEventDateTime(s: string): boolean {
  const m = DATETIME.exec(s);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h <= 23 && mi <= 59;
}

/** 日時を分けたもの（媒体の画面の欄に合わせる）。 */
export type EventDateParts = {
  date: string;
  time: string;
  month: number;
  day: number;
  weekday: string;
  year: number;
};

/**
 * 「YYYY-MM-DDTHH:mm」を、日付・時刻・曜日に分ける。
 * @param s - 日時
 * @returns 分けたもの
 */
export function eventDateParts(s: string): EventDateParts {
  const [date = "", time = ""] = s.split("T");
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
  return { date, time, month: mo, day: d, weekday, year: y };
}

/**
 * 開催日時の見やすい形（例：2026年11月25日(水) 20:00 〜 22:00）。
 * @param e - イベントの情報
 * @returns 文字列
 */
export function formatEventWhen(e: Pick<PromotionEvent, "startAt" | "endAt">): string {
  const s = eventDateParts(e.startAt);
  const head = `${s.year}年${s.month}月${s.day}日(${s.weekday}) ${s.time}`;
  if (!e.endAt) return `${head} 〜`;
  const t = eventDateParts(e.endAt);
  return t.date === s.date
    ? `${head} 〜 ${t.time}`
    : `${head} 〜 ${t.month}月${t.day}日(${t.weekday}) ${t.time}`;
}

/**
 * 短い日付（例：11/25(水)）。
 * @param startAt - 開始の日時
 * @returns 文字列
 */
export function formatEventShortDate(startAt: string): string {
  const s = eventDateParts(startAt);
  return `${s.month}/${s.day}(${s.weekday})`;
}

/**
 * 場所の見やすい形（会場名・最寄り駅。オンラインなら「オンライン」）。
 * @param e - イベントの情報
 * @returns 文字列（なにもなければ空）
 */
export function formatEventPlace(
  e: Pick<PromotionEvent, "format" | "venueName" | "station">,
): string {
  if (e.format === "online") return "オンライン";
  const parts = [e.venueName, e.station ? `（${e.station}）` : null].filter(Boolean);
  return parts.join("");
}

/**
 * 参加費の見やすい形（例：5,000円・無料）。
 * @param e - イベントの情報
 * @returns 文字列（金額がなければ参加費の説明、どちらもなければ空）
 */
export function formatEventFee(e: Pick<PromotionEvent, "feeYen" | "feeNote">): string {
  if (e.feeYen === 0) return "無料";
  if (e.feeYen !== null) return `${e.feeYen.toLocaleString("ja-JP")}円`;
  return e.feeNote ?? "";
}

/**
 * 住所をつなげたもの（都道府県・市区町村・番地・建物）。
 * @param e - イベントの情報
 * @returns 文字列（なければ空）
 */
export function formatEventAddress(
  e: Pick<PromotionEvent, "prefecture" | "address" | "building">,
): string {
  return [e.prefecture, e.address, e.building ? ` ${e.building}` : null].filter(Boolean).join("");
}

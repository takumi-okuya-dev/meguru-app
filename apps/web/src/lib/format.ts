// 日時・日付の表示（日本時間）

const dateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * 日時を「2026/10/3 09:30」の形にする（日本時間）。
 * @param iso - ISO 8601 の日時
 * @returns 表示用の文字列
 */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/**
 * 日付を「2026年10月3日」の形にする（日本時間）。
 * @param iso - ISO 8601 の日時
 * @returns 表示用の文字列
 */
export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/**
 * 掲載期限（YYYY-MM-DD）を「10/3」の形にする。
 * @param ymd - YYYY-MM-DD
 * @returns 表示用の文字列
 */
export function formatMonthDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

const JST_OFFSET_MS = 9 * 3600_000;

/**
 * 日本時間の年月日・時分を求める。
 * @param d - 日時
 * @returns 日本時間の各部分
 */
function jstParts(d: Date) {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return {
    y: j.getUTCFullYear(),
    m: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    h: j.getUTCHours(),
    min: j.getUTCMinutes(),
  };
}

/**
 * 日本時間の日付を比較する通し番号を求める。
 * @param d - 日時
 * @returns 1970年からの日数
 */
const jstDayIndex = (d: Date) => Math.floor((d.getTime() + JST_OFFSET_MS) / 86_400_000);

/**
 * 予定・投稿の日時を、今日・明日を言葉にして出す（日本時間。specs/005-auto-post contracts/ui-routes.md「日時の書き方」）。
 * 「今日 12:00」「明日 7:30」「10月8日 21:00」、年が違えば「2027年1月3日 7:30」。
 * @param iso - ISO 8601 の日時（または Date）
 * @param now - 今の時刻
 * @returns 表示用の文字列
 */
export function formatRelativeJst(iso: string | Date, now: Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = jstParts(d);
  const time = `${p.h}:${String(p.min).padStart(2, "0")}`;
  const diff = jstDayIndex(d) - jstDayIndex(now);
  if (diff === 0) return `今日 ${time}`;
  if (diff === 1) return `明日 ${time}`;
  if (p.y !== jstParts(now).y) return `${p.y}年${p.m}月${p.day}日 ${time}`;
  return `${p.m}月${p.day}日 ${time}`;
}

/**
 * 設定の時刻（"07:30"）を「7:30」にする。
 * @param hhmm - "HH:MM"
 * @returns 表示用の文字列
 */
export function formatSlotTime(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  return `${Number(h)}:${m}`;
}

/**
 * 過ぎた日を「今日」「昨日」「10/26（9日前）」にする（日本時間の日付で数える。specs/020 contracts/ui-routes.md 2）。
 * @param iso - ISO 8601 の日時
 * @param now - 今の時刻
 * @returns 表示用の文字列
 */
export function formatDaysAgoJst(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = jstDayIndex(now) - jstDayIndex(d);
  if (diff <= 0) return "今日";
  if (diff === 1) return "昨日";
  const p = jstParts(d);
  return `${p.m}/${p.day}（${diff}日前）`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 日本時間の「月/日」（specs/006 contracts/ui-routes.md）。
 * @param iso - ISO 8601 の日時
 * @returns 「10/12」
 */
export function formatJstMonthDay(iso: string): string {
  const p = jstParts(new Date(iso));
  return `${p.m}/${p.day}`;
}

/**
 * 日本時間の「月/日 時:分」。
 * @param iso - ISO 8601 の日時
 * @returns 「10/8 21:00」
 */
export function formatJstShort(iso: string): string {
  const p = jstParts(new Date(iso));
  return `${p.m}/${p.day} ${p.h}:${String(p.min).padStart(2, "0")}`;
}

/**
 * 日本時間の「月/日(曜) 時:分」。投稿のカードの日時。
 * @param iso - ISO 8601 の日時
 * @returns 「9/25(木) 19:01」
 */
export function formatJstWithWeekday(iso: string): string {
  const d = new Date(iso);
  const p = jstParts(d);
  const w = WEEKDAYS[new Date(d.getTime() + JST_OFFSET_MS).getUTCDay()];
  return `${p.m}/${p.day}(${w}) ${p.h}:${String(p.min).padStart(2, "0")}`;
}

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

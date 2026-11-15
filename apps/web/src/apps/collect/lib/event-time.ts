// イベントの日時の入力（日本時間の日付と時刻）と、APIの日時（ISO 8601）の行き来（specs/collect/001-event-day-collection research.md R14）。

/** 日本時間の時差（ミリ秒）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * ISO 8601 の日時を、日本時間の日付（YYYY-MM-DD）と時刻（HH:MM）にする。
 * @param iso - 日時
 * @returns 日付と時刻
 */
export function toJstParts(iso: string): { date: string; time: string } {
  const jst = new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString();
  return { date: jst.slice(0, 10), time: jst.slice(11, 16) };
}

/**
 * 日本時間の日付と時刻を、ISO 8601 の日時（時差つき）にする。
 * @param date - 日付（YYYY-MM-DD）
 * @param time - 時刻（HH:MM）
 * @returns 日時
 */
export function fromJstParts(date: string, time: string): string {
  return new Date(`${date}T${time}:00+09:00`).toISOString();
}

/**
 * 終わりの時刻を日時にする。始まりの時刻より前（同じを含む）なら、次の日の時刻とみなす（19:00〜翌1:00 のイベント）。
 * @param date - 開催日（YYYY-MM-DD）
 * @param start - 始まりの時刻（HH:MM）
 * @param end - 終わりの時刻（HH:MM。空なら終わりなし）
 * @returns 終わりの日時（なければ null）
 */
export function endsAtFrom(date: string, start: string, end: string): string | null {
  if (!end) return null;
  const ends = new Date(fromJstParts(date, end));
  if (end <= start) ends.setUTCDate(ends.getUTCDate() + 1);
  return ends.toISOString();
}

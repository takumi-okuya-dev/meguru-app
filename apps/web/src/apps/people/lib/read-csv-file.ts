// アンケートのCSVのファイルを読む（specs/people/001-people-memo research.md R4・R18）。
// 読んだ見出しと行は、呼び出した画面のメモリーにだけ返す（localStorage・sessionStorage・IndexedDB に書かない）。
import { CSV_MAX_BYTES, checkCsvLimits, decodeCsvBytes, parseCsv, type CsvLimitViolation } from "@meguru/shared/people";

/** 読めなかったときの文言（research.md R4、spec Edge Cases「CSVの文字化け」）。 */
export const CSV_READ_MESSAGES = {
  tooLarge: "ファイルが大きすぎます（1MBまで）",
  zip: "ZIPのまま上げられました。Googleフォームの『回答をダウンロード（.csv）』はZIPになるので、展開してから上げるか、回答のスプレッドシートから『ファイル → ダウンロード → カンマ区切り形式（.csv）』を使ってください",
  unreadable: "Googleフォームの回答のスプレッドシートから『CSV形式でダウンロード』したファイルを上げてください",
} as const;

/** 上限を超えたときの文言。 */
const LIMIT_MESSAGES: Record<CsvLimitViolation, string> = {
  no_header: CSV_READ_MESSAGES.unreadable,
  too_many_rows: "行が多すぎます。1回に取り込めるのは500行までです",
  too_many_columns: "列が多すぎます。60列までのCSVにしてください",
  header_too_long: "質問文が長すぎる列があります（1列500文字まで）",
  cell_too_long: "長すぎる答えがあります（1つ5,000文字まで）",
};

/** 読んだCSV。 */
export type CsvFileResult = { ok: true; headers: string[]; rows: string[][] } | { ok: false; message: string };

/**
 * CSVのファイルを読む。1MBを超えたら読まない → 文字にする（UTF-8 → Shift_JIS）→ 表にする → 上限を確かめる。
 * @param file - 選んだファイル
 * @returns 見出しと行、または読めなかった理由の文言
 */
export async function readCsvFile(file: File): Promise<CsvFileResult> {
  if (file.size > CSV_MAX_BYTES) return { ok: false, message: CSV_READ_MESSAGES.tooLarge };
  const bytes = new Uint8Array(await readBytes(file));
  const decoded = decodeCsvBytes(bytes);
  if (!decoded.ok) return { ok: false, message: CSV_READ_MESSAGES[decoded.reason] };
  const csv = parseCsv(decoded.text);
  const limits = checkCsvLimits(csv);
  if (!limits.ok) return { ok: false, message: LIMIT_MESSAGES[limits.reason] };
  return { ok: true, headers: csv.headers, rows: csv.rows };
}

/**
 * ファイルの中身を読む（arrayBuffer のない古い環境では FileReader）。
 * @param file - ファイル
 * @returns 中身
 */
function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

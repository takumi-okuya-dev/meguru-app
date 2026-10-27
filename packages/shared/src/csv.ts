// CSVの整形（specs/006-performance-feedback contracts/csv.md、FR-028〜FR-030、research.md R7）。
// CSVはWebで組み立てる（Workerで数千行を組み立てると、CPU時間の上限を超えるおそれがあるため）。
import type { PostExportRow, SnapshotExportRow } from "./schemas";
import { countChars } from "./text";

/** CSVの1つの値。null・undefined は空欄。 */
export type CsvCell = string | number | null | undefined;

const JST_OFFSET_MS = 9 * 3600_000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 表計算ソフトが数式として読み始める先頭文字（`=`・`+`・`-`・`@`、タブ、CR）。
 *
 * 引用符で囲むのは「セルの区切り」を伝える制御で、「評価するな」を伝える制御ではない。
 * ソフトは囲みを外した後の先頭文字で数式かどうかを決めるので、`"=HYPERLINK(…)"` は
 * 数式になりうる。このファイルは先頭にBOMを付けている＝読み手が表計算ソフトである前提なので、
 * ここで無害化する（セキュリティ監査 run-1）。
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * CSVの1つの値を、引用した文字列にする。
 * @param c - 値（null・undefined は空欄）
 * @returns 引用済みの文字列
 */
function cell(c: CsvCell): string {
  const raw = c === null || c === undefined ? "" : String(c);
  // 先頭にシングルクォートを足すと、表計算ソフトは「文字列」として読む（セルの表示には出ない）
  const safe = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * CSVの文字列にする（RFC 4180）。先頭にBOM（Excelで文字化けしないため）、改行はCRLF、すべての値を引用する。
 * 先頭が数式の記号になる値は、文字列として読まれる形にする。
 * @param header - 列名
 * @param rows - 行
 * @returns CSVの全文
 */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const line = (cells: readonly CsvCell[]) => cells.map(cell).join(",");
  return `\uFEFF${[header, ...rows].map(line).join("\r\n")}\r\n`;
}

/**
 * 日本時間の、タイムゾーン付きの日時（2026-09-25T19:01:00+09:00）。
 * @param iso - ISO 8601 の日時（null なら空）
 * @returns 文字列
 */
export function formatJstIso(iso: string | null): string {
  if (!iso) return "";
  const j = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}T${pad(j.getUTCHours())}:${pad(
    j.getUTCMinutes(),
  )}:${pad(j.getUTCSeconds())}+09:00`;
}

/**
 * 日本時間の曜日（日〜土）。
 * @param iso - ISO 8601 の日時
 * @returns 曜日
 */
export function weekdayJst(iso: string): string {
  return WEEKDAYS[new Date(new Date(iso).getTime() + JST_OFFSET_MS).getUTCDay()]!;
}

/**
 * 日本時間の時（0〜23）。
 * @param iso - ISO 8601 の日時
 * @returns 時
 */
export function hourJst(iso: string): number {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).getUTCHours();
}

/**
 * CSVのファイル名（threads-{username}-{posts|snapshots}-{YYYYMMDD}.csv。日付は日本時間）。
 * @param username - Threadsのユーザー名
 * @param kind - 投稿ごとか取り込みごとか
 * @param now - 書き出した日時
 * @returns ファイル名
 */
export function csvFileName(username: string, kind: "posts" | "snapshots", now: Date): string {
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  return `threads-${username}-${kind}-${j.getUTCFullYear()}${pad(j.getUTCMonth() + 1)}${pad(j.getUTCDate())}.csv`;
}

const METRIC_HEADERS = ["閲覧", "いいね", "返信", "リポスト", "引用", "シェア"] as const;

/** 「投稿ごと」の列名（contracts/csv.md の37列）。 */
export const POST_EXPORT_HEADER: readonly string[] = [
  "投稿ID",
  "投稿した日時",
  "曜日",
  "時",
  "本文",
  "文字数",
  ...METRIC_HEADERS,
  "基準値に対する倍率",
  "判定",
  "投稿のURL",
  "反応数の最終取り込み日時",
  "取り込み時の経過時間",
  "値の状態",
  "投稿時点のフォロワー数",
  ...METRIC_HEADERS.map((h) => `24時間時点の${h}`),
  "バッチID",
  "バッチの中の順番",
  "バッチを登録した日時",
  "承認した日時",
  "次に投稿するで前に出したか",
  "持ち越されたか",
  "登録の後に本文を直したか",
  "予定の時刻の枠",
  "バッチ登録時の課題の最終更新日時",
  "バッチ登録時の宣伝内容の最終更新日時",
  "バッチ登録時のリサーチの最終更新日時",
  "バッチ登録時の投稿ルールの最終更新日時",
];

/** 「取り込みごと」の列名（contracts/csv.md の13列）。 */
export const SNAPSHOT_EXPORT_HEADER: readonly string[] = [
  "投稿ID",
  "投稿した日時",
  "取り込んだ日時",
  "取り込み時の経過時間",
  "取り込みの種類",
  "取り方",
  ...METRIC_HEADERS,
  "その時点のフォロワー数",
];

type MetricsCells = { views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null; shares: number | null };

const metricCells = (m: MetricsCells | null): CsvCell[] =>
  m ? [m.views, m.likes, m.replies, m.reposts, m.quotes, m.shares] : [null, null, null, null, null, null];

const yesNo = (v: boolean | null): CsvCell => (v === null ? "" : v ? "はい" : "いいえ");

const JUDGMENT_LABEL = { good: "好調", normal: "普通", poor: "低調" } as const;
const STATE_LABEL = { updating: "更新中", confirmed: "確定", late_confirmed: "遅れて確定" } as const;
const KIND_LABEL = { h24: "24時間時点", d3: "3日時点", d7: "7日時点", late: "遅れて確定" } as const;

/**
 * 判定の列（好調・普通・低調・確定待ち・計測できません・判定なし）。
 * @param row - 投稿ごとの行
 * @returns 判定の文字
 */
function judgmentCell(row: PostExportRow): string {
  if (row.state === "pending" || row.state === "updating") return "確定待ち";
  if (row.state === "unmeasurable") return "計測できません";
  return row.judgment ? JUDGMENT_LABEL[row.judgment] : "判定なし";
}

/**
 * 「投稿ごと」の1行の値（POST_EXPORT_HEADER の順）。
 * @param row - APIが返した行
 * @returns 値
 */
export function postExportCells(row: PostExportRow): CsvCell[] {
  const slot =
    row.slotMinute === null ? "" : `${pad(Math.floor(row.slotMinute / 60))}:${pad(row.slotMinute % 60)}`;
  return [
    row.id,
    formatJstIso(row.publishedAt),
    weekdayJst(row.publishedAt),
    hourJst(row.publishedAt),
    row.body,
    countChars(row.body),
    ...metricCells(row.metrics),
    row.ratio === null ? null : row.ratio.toFixed(3),
    judgmentCell(row),
    row.permalink ?? "",
    formatJstIso(row.lastFetchedAt),
    row.lastElapsedMinutes === null ? null : Math.floor(row.lastElapsedMinutes / 60),
    row.state in STATE_LABEL ? STATE_LABEL[row.state as keyof typeof STATE_LABEL] : "",
    row.followersAtPost,
    ...metricCells(row.h24),
    row.batchId,
    row.batchPosition + 1,
    formatJstIso(row.batchCreatedAt),
    formatJstIso(row.approvedAt),
    yesNo(row.prioritized),
    yesNo(row.carryover),
    row.bodyEdited === null ? "不明" : row.bodyEdited ? "はい" : "いいえ",
    slot,
    formatJstIso(row.strategyUpdatedAt),
    formatJstIso(row.promotionsChangedAt),
    formatJstIso(row.researchChangedAt),
    formatJstIso(row.coreRulesChangedAt),
  ];
}

/**
 * 「取り込みごと」の1行の値（SNAPSHOT_EXPORT_HEADER の順）。
 * @param row - APIが返した行
 * @returns 値
 */
export function snapshotExportCells(row: SnapshotExportRow): CsvCell[] {
  return [
    row.id,
    formatJstIso(row.publishedAt),
    formatJstIso(row.fetchedAt),
    Math.floor(row.elapsedMinutes / 60),
    KIND_LABEL[row.kind],
    row.method === "slot" ? "時刻の処理" : "毎日の処理",
    ...metricCells(row.metrics),
    row.followersOnDay,
  ];
}

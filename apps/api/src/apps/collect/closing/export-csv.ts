// 書き出し（specs/collect/001-event-day-collection FR-046、research.md R13、tasks.md T059）。
// UTF-8（BOMつき）・改行 CRLF・受付番号の順。Excel で文字化けせずに開ける。ファイル名は「集金_<開催日>_<イベント名>.csv」。
import { COLLECT_MEDIA_LABELS, RECEPTION_METHOD_LABELS, type CollectMedia, type ReceptionMethod } from "@meguru/shared";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { loadOwnedEvent } from "../access";
import { collectHelpers, collectPriceTiers, collectReceptionRecords, collectRosterPeople } from "../schema";

const HEADER = ["受付番号", "名前", "ふりがな", "媒体", "料金の区分", "来場", "払い方", "金額", "受け取った人", "記録した時刻", "入金を確かめた日", "メモ"];
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 日本時間の日時・日付の文字列。
 * @param date - 時刻
 * @param withTime - 時刻も入れるか
 * @returns 「2026-11-20 19:05」か「2026-11-20」
 */
function jst(date: Date, withTime: boolean): string {
  const iso = new Date(date.getTime() + JST_OFFSET_MS).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/**
 * CSV の1つの値（区切り・引用符・改行を含むときは引用符で囲む。表計算ソフトの式として読まれる頭の文字は ' を付けて止める）。
 * @param value - 値
 * @returns CSV の値
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * イベントの名簿と受付の記録を CSV にする。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @returns CSV の本文（BOMつき）とファイル名
 */
export async function exportCsv(db: Db, ownerUserId: string, eventId: string): Promise<{ body: string; filename: string }> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  const [people, records, tiers, helpers] = await Promise.all([
    db.select().from(collectRosterPeople).where(eq(collectRosterPeople.eventId, event.id)).orderBy(asc(collectRosterPeople.number)),
    db.select().from(collectReceptionRecords).where(eq(collectReceptionRecords.eventId, event.id)),
    db.select({ id: collectPriceTiers.id, name: collectPriceTiers.name }).from(collectPriceTiers).where(eq(collectPriceTiers.eventId, event.id)),
    db.select({ id: collectHelpers.id, name: collectHelpers.name }).from(collectHelpers).where(eq(collectHelpers.eventId, event.id)),
  ]);
  const recordOf = new Map(records.map((r) => [r.rosterPersonId, r]));
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));
  const helperName = new Map(helpers.map((h) => [h.id, h.name]));
  const rows = people.map((p) => {
    const r = recordOf.get(p.id);
    return [
      p.number,
      p.name,
      p.kana ?? "",
      COLLECT_MEDIA_LABELS[p.media as CollectMedia] ?? p.media,
      tierName.get(r?.priceTierId ?? p.priceTierId) ?? "",
      r ? "来場" : "",
      r ? RECEPTION_METHOD_LABELS[r.method as ReceptionMethod] : "",
      r ? r.amount : "",
      r ? (r.receiverHelperId ? (helperName.get(r.receiverHelperId) ?? "手伝う人") : "主催者") : "",
      r ? jst(r.recordedAt, true) : "",
      r?.transferConfirmedAt ? jst(r.transferConfirmedAt, false) : "",
      p.memo ?? "",
    ];
  });
  const body = `\uFEFF${[HEADER, ...rows].map((cols) => cols.map(csvCell).join(",")).join("\r\n")}\r\n`;
  return { body, filename: `集金_${jst(event.startsAt, false)}_${event.name.replace(/[\\/:*?"<>|\r\n]/g, "_")}.csv` };
}

/**
 * ファイル名の見出し（RFC 5987。日本語のファイル名は filename* に入れ、filename には英数字の代わりの名前）。
 * @param filename - ファイル名
 * @returns Content-Disposition の値
 */
export function contentDisposition(filename: string): string {
  return `attachment; filename="collect.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

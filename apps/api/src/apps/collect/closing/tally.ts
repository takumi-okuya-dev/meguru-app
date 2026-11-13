// 締めとイベントのまとめの数字（specs/collect/001-event-day-collection data-model.md 4、FR-040・FR-043・FR-044・FR-014）。
// 名簿の人と受付の記録から毎回数える（数字は持たない）。締めの画面とまとめで同じ数え方を使う。
import { COLLECT_MEDIA, RECEPTION_METHODS, type ByMethod, type CollectMedia, type CountAmount, type MediaStats, type ReceptionMethod } from "@meguru/shared";

/** 数えるのに使う名簿の人。 */
export type TallyPerson = { id: string; media: string };
/** 数えるのに使う受付の記録。 */
export type TallyRecord = { rosterPersonId: string; method: string; amount: number; paymentStatus: string };

/** 数字。 */
export type Tally = {
  attendance: { arrived: number; rosterCount: number };
  byMethod: ByMethod;
  byMedia: MediaStats[];
  transfers: { paid: CountAmount; awaiting: CountAmount };
};

/**
 * 名簿の人と受付の記録から数字を作る。媒体ごとの行は、名簿に1人でもいる媒体だけ（媒体の並びのとおり）。
 * @param people - 名簿の人
 * @param records - 受付の記録
 * @returns 数字
 */
export function tally(people: readonly TallyPerson[], records: readonly TallyRecord[]): Tally {
  const byMethod = Object.fromEntries(RECEPTION_METHODS.map((m) => [m, { count: 0, amount: 0 }])) as ByMethod;
  const transfers = { paid: { count: 0, amount: 0 }, awaiting: { count: 0, amount: 0 } };
  const media = new Map<CollectMedia, MediaStats>();
  const mediaOf = new Map(people.map((p) => [p.id, p.media as CollectMedia]));
  for (const p of people) {
    const m = p.media as CollectMedia;
    const row = media.get(m) ?? { media: m, roster: 0, attended: 0, paid: 0, awaiting: 0 };
    row.roster += 1;
    media.set(m, row);
  }
  for (const r of records) {
    const slot = byMethod[r.method as ReceptionMethod];
    slot.count += 1;
    slot.amount += r.amount;
    const transfer = r.method === "transfer_today" || r.method === "transfer_later";
    const awaiting = r.paymentStatus === "awaiting_transfer";
    if (transfer) {
      const t = awaiting ? transfers.awaiting : transfers.paid;
      t.count += 1;
      t.amount += r.amount;
    }
    const row = media.get(mediaOf.get(r.rosterPersonId)!);
    if (row) {
      row.attended += 1;
      if (awaiting) row.awaiting += r.amount;
      else row.paid += r.amount;
    }
  }
  return {
    attendance: { arrived: records.length, rosterCount: people.length },
    byMethod,
    byMedia: COLLECT_MEDIA.flatMap((m) => (media.has(m) ? [media.get(m)!] : [])),
    transfers,
  };
}

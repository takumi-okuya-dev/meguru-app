// 分配のもとの売上と、紹介経由の売上の数え方（specs/collect/003-revenue-sharing research.md R3・R4、FR-016・FR-021）。
// 001 の締めの数え方（tally）をそのまま使う。本人の申告の確かめ待ち（002）は、来場には数えるが売上に入れない。
import type { ReferralRow } from "@meguru/shared";
import type { Tally, TallyRecord } from "../closing/tally";

/** 売上（支払い済み・振込待ち・確かめ待ち）。 */
export type Revenue = { paid: number; awaiting: number; awaitingConfirmation: number };

/**
 * 締めの数字から売上を出す。支払い済み＝払い方ごとの合計 − 振込待ち。
 * @param t - 締めの数字
 * @returns 売上
 */
export function revenueOf(t: Tally): Revenue {
  const total = Object.values(t.byMethod).reduce((s, m) => s + m.amount, 0);
  return { paid: total - t.transfers.awaiting.amount, awaiting: t.transfers.awaiting.amount, awaitingConfirmation: t.awaitingConfirmation.amount };
}

/** 数えるのに使う名簿の人（紹介した人つき）。 */
export type ReferralPerson = { id: string; number: number; referrer: string | null; referrerKey: string | null };

/**
 * 紹介した人ごとの数字（FR-021）。名前は同じ形（referrer_key）のうち受付番号のいちばん小さい人のもの。
 * 人数の多い順（同じなら名前の順）、「紹介なし」（name が null）は最後。紹介なしの人がいなければ行を出さない。
 * @param people - 名簿の人
 * @param records - 受付の記録
 * @returns 行
 */
export function referralRows(people: readonly ReferralPerson[], records: readonly TallyRecord[]): ReferralRow[] {
  const recordOf = new Map(records.map((r) => [r.rosterPersonId, r]));
  const groups = new Map<string, ReferralRow & { first: number }>();
  for (const p of [...people].sort((a, b) => a.number - b.number)) {
    const key = p.referrerKey ?? "";
    const row = groups.get(key) ?? { name: p.referrerKey === null ? null : p.referrer, people: 0, attended: 0, paid: 0, awaiting: 0, first: p.number };
    row.people += 1;
    const r = recordOf.get(p.id);
    if (r) {
      row.attended += 1;
      if (r.paymentStatus === "awaiting_transfer") row.awaiting += r.amount;
      else if (r.paymentStatus !== "awaiting_confirmation") row.paid += r.amount;
    }
    groups.set(key, row);
  }
  const rows = [...groups.values()];
  const named = rows.filter((r) => r.name !== null).sort((a, b) => b.people - a.people || a.first - b.first);
  const none = rows.filter((r) => r.name === null);
  return [...named, ...none].map(({ first: _first, ...row }) => row);
}

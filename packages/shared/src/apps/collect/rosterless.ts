// 名簿なしで受付する（specs/collect/004-rosterless-check-in research.md R3）。
// 参加者は区分を選ばないので、名簿に入れるときの仮の区分と、区分を受付で決める必要があるかを決める。API と画面で同じものを使う。
import { COLLECT_MEDIA, type CollectMedia } from "./media";
import { nameKey } from "./names";

/** 区分の決め方に使う形（名前は使わない）。 */
type TierLike = { amount: number; position: number };

/**
 * 区分を受付で決める必要があるか。区分が2つ以上なら true（0円の区分も数える）。
 * @param tiers - イベントの区分
 * @returns 決める必要があれば true
 */
export function tierUndecidedFor(tiers: readonly TierLike[]): boolean {
  return tiers.length >= 2;
}

/**
 * 名簿なしで入った人に仮に入れる区分。0円を除いた最も安い区分（同じ金額なら並びの先）。0円しかなければ並びの最初。
 * 仮の金額は、支払い済みになるまで合計に入らず、振込待ちの見込みには多く見積もらない額で入る（research R3）。
 * @param tiers - イベントの区分（1つ以上）
 * @returns 仮の区分（区分がなければ undefined）
 */
export function provisionalTier<T extends TierLike>(tiers: readonly T[]): T | undefined {
  const byPosition = [...tiers].sort((a, b) => a.position - b.position);
  const paid = byPosition.filter((t) => t.amount > 0).sort((a, b) => a.amount - b.amount || a.position - b.position);
  return paid[0] ?? byPosition[0];
}

/**
 * 同じ名前（nameKey が同じ）の人が2人以上いる人の番号（research R4。名簿なしで受付の画面に「同じ名前の人がいます」を出す）。
 * 会場の共有で人が増えたあとも、画面が同じ決まりで出し直せるよう共通に置く。
 * @param people - 名簿の人（番号と名前）
 * @returns 同じ名前の人がほかにもいる人の番号
 */
export function sameNameIds(people: readonly { id: string; name: string }[]): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const p of people) {
    const key = nameKey(p.name);
    if (key === "") continue;
    byKey.set(key, [...(byKey.get(key) ?? []), p.id]);
  }
  return new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());
}

/**
 * 名簿なしの参加者の画面に並べる媒体の順（001 の媒体の並び。Threads で掲載済みの媒体を先に。名簿の画面と同じ）。
 * @param posted - 掲載済みの媒体
 * @returns 並べる順の媒体
 */
export function mediaInOrder(posted: readonly CollectMedia[] = []): CollectMedia[] {
  return [...COLLECT_MEDIA.filter((m) => posted.includes(m)), ...COLLECT_MEDIA.filter((m) => !posted.includes(m))];
}

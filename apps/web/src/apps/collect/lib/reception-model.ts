// 受付の画面の状態を直す純粋な関数（specs/collect/001-event-day-collection contracts/realtime.md 2、data-model.md 4）。
// 会場の共有の知らせと自分の操作の応答を、スナップショットに当てる。数字はAPIと同じ決まりで数え直す。
import { nameKey, type ReceptionPerson, type ReceptionRecord, type ReceptionSnapshot, type ReceptionStats } from "@meguru/shared";

/** 受付をする人（画面の側。数字の「あなたが受け取った現金」と、取り消せる記録の見分けに使う）。 */
export type ReceptionViewer = { kind: "owner" } | { kind: "helper"; helperId: string };

/**
 * 記録を受け取ったのが、画面を見ている人か。
 * @param record - 受付の記録
 * @param viewer - 画面を見ている人
 * @returns 自分が受け取った記録なら true
 */
export function isMine(record: ReceptionRecord, viewer: ReceptionViewer): boolean {
  return viewer.kind === "owner" ? record.receiverKind === "owner" : record.receiverHelperId === viewer.helperId;
}

/**
 * 受付の画面の数字（data-model.md 4。APIの computeStats と同じ決まり）。
 * @param people - 名簿の人と記録
 * @param viewer - 画面を見ている人
 * @returns 数字
 */
export function statsOf(people: ReceptionSnapshot["people"], viewer: ReceptionViewer): ReceptionStats {
  const stats: ReceptionStats = { arrived: 0, rosterCount: people.length, cash: 0, paypay: 0, awaitingTransferCount: 0, awaitingTransferAmount: 0, mine: 0 };
  for (const { record } of people) {
    if (!record) continue;
    stats.arrived += 1;
    if (record.method === "cash") {
      stats.cash += record.amount;
      if (isMine(record, viewer)) stats.mine += record.amount;
    }
    if (record.method === "paypay") stats.paypay += record.amount;
    if (record.paymentStatus === "awaiting_transfer") {
      stats.awaitingTransferCount += 1;
      stats.awaitingTransferAmount += record.amount;
    }
  }
  return stats;
}

/**
 * 1人の記録を入れ替える（null なら未受付に戻す）。
 * @param snap - スナップショット
 * @param personId - 名簿の人の番号
 * @param record - 記録
 * @param viewer - 画面を見ている人
 * @returns 新しいスナップショット（版はそのまま）
 */
export function withRecord(snap: ReceptionSnapshot, personId: string, record: ReceptionRecord | null, viewer: ReceptionViewer): ReceptionSnapshot {
  const people = snap.people.map((p) => (p.person.id === personId ? { ...p, record } : p));
  return { ...snap, people, stats: statsOf(people, viewer) };
}

/**
 * 名簿の人を足す・直す（受付番号の順に並べる）。メモの知らせは来ないので、今のメモを残す。
 * @param snap - スナップショット
 * @param person - 名簿の人
 * @param viewer - 画面を見ている人
 * @returns 新しいスナップショット（版はそのまま）
 */
export function withPerson(snap: ReceptionSnapshot, person: ReceptionPerson, viewer: ReceptionViewer): ReceptionSnapshot {
  const current = snap.people.find((p) => p.person.id === person.id);
  const merged = current ? { ...current, person: { ...current.person, ...person } } : { person, record: null };
  const people = [...snap.people.filter((p) => p.person.id !== person.id), merged].sort((a, b) => a.person.number - b.person.number);
  return { ...snap, people, stats: statsOf(people, viewer) };
}

/**
 * 検索の言葉に合う人か（名前・ふりがな・受付番号の一部。ひらがなとカタカナ・全角と半角・空白を区別しない）。
 * @param person - 名簿の人
 * @param query - 検索の言葉
 * @returns 合えば true（言葉が空ならいつも true）
 */
export function matchesQuery(person: ReceptionPerson, query: string): boolean {
  const q = nameKey(query);
  if (q === "") return true;
  if (/^\d+$/.test(q) && String(person.number).startsWith(q)) return true;
  return nameKey(person.name).includes(q) || (person.kana !== null && nameKey(person.kana).includes(q));
}

/**
 * 金額を円で書く。
 * @param amount - 円
 * @returns 「3,000円」
 */
export function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

// 投稿の順（specs/005-auto-post research.md R4、FR-005・FR-005a）。APIの一覧のSQLも同じ並びにする。

/** 投稿の順を決める項目。日時は ISO 8601 の文字列か Date。 */
export type QueueItem = {
  id: string;
  /** 前の時刻から持ち越したか */
  carryover: boolean;
  /** 「次に投稿する」の日時 */
  prioritizedAt: string | Date | null;
  /** 承認した日時 */
  reviewedAt: string | Date | null;
};

const time = (v: string | Date | null) => (v === null ? null : new Date(v).getTime());

/**
 * 投稿の順で比べる。持ち越し → 「次に投稿する」の新しい順 → 承認した古い順 → id の順。
 * @param a - 比べる下書き
 * @param b - 比べる下書き
 * @returns Array.prototype.sort の比較の値
 */
export function compareQueueOrder(a: QueueItem, b: QueueItem): number {
  if (a.carryover !== b.carryover) return a.carryover ? -1 : 1;
  const pa = time(a.prioritizedAt);
  const pb = time(b.prioritizedAt);
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pb - pa;
  }
  const ra = time(a.reviewedAt);
  const rb = time(b.reviewedAt);
  if (ra !== rb) {
    if (ra === null) return 1;
    if (rb === null) return -1;
    return ra - rb;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

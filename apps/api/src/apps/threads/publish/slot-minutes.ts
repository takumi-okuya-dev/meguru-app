// 投稿に使う時刻（specs/024 FR-020）。029 で共通（operator/limit-service.ts）から移した（Threadsの投稿の計算。specs/meguru/029 tasks.md T027）。

/**
 * 投稿に使う時刻（早い時刻から、1日の投稿数の上限の数まで。specs/024 FR-020）。
 * 時刻の一覧を読んで数える・予定を求める・投稿するところは、すべてここを通す（PR #71 のセルフレビュー）。
 * @param slotMinutes - 登録した時刻（0時からの分）
 * @param limit - 1日の投稿数の上限（省けば切らない）
 * @returns 投稿に使う時刻（昇順）
 */
export function effectiveSlotMinutes(slotMinutes: readonly number[], limit: number | undefined): number[] {
  const sorted = [...slotMinutes].sort((a, b) => a - b);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

// 人物メモの表示の小さな部品（日付・数）。

/**
 * 開催日（YYYY-MM-DD）を「2026年11月25日」の形にする。
 * @param ymd - YYYY-MM-DD
 * @returns 表示用の文字列
 */
export function formatHeldOn(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

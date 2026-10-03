// 宣伝内容の「期限切れ」「宣伝の対象」と並び順（specs/002-strategy-profile FR-008・FR-009、research.md R6）。
// 一覧の API と、後続のプロンプト生成が同じ判定を使う。

/** 宣伝内容の状態。「期限切れ」は状態ではなく、掲載期限から求める。 */
export type PromotionStatus = "active" | "paused" | "ended";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 日本時間の今日を YYYY-MM-DD で返す（日本には夏時間がないので +9 時間で求める）。
 * @param now - 現在時刻
 * @returns 日本時間の今日
 */
export function jstToday(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 掲載期限を過ぎたかを確かめる。掲載期限の日の終わり（日本時間）までは有効。
 * @param validUntil - 掲載期限（YYYY-MM-DD）。なければ null
 * @param now - 現在時刻
 * @returns 期限切れなら true
 */
export function isExpired(validUntil: string | null, now: Date): boolean {
  return validUntil !== null && validUntil < jstToday(now);
}

/**
 * 宣伝の対象かを確かめる：状態が有効で、期限切れでない（FR-008）。
 * @param status - 状態
 * @param validUntil - 掲載期限
 * @param now - 現在時刻
 * @returns 宣伝の対象なら true
 */
export function isTargetable(status: PromotionStatus, validUntil: string | null, now: Date): boolean {
  return status === "active" && !isExpired(validUntil, now);
}

/** 並べ替えに使う宣伝内容の項目。 */
type Sortable = { status: PromotionStatus; validUntil: string | null; priority: number; createdAt: string };

/**
 * 宣伝内容を FR-009 の順に並べる：宣伝の対象を先に、それぞれの中は優先度の降順、同じなら新しく登録した順。
 * @param items - 宣伝内容
 * @param now - 現在時刻
 * @returns 並べた新しい配列
 */
export function sortPromotions<T extends Sortable>(items: T[], now: Date): T[] {
  return [...items].sort((a, b) => {
    const ta = isTargetable(a.status, a.validUntil, now) ? 0 : 1;
    const tb = isTargetable(b.status, b.validUntil, now) ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * 実在する日付の YYYY-MM-DD かを確かめる（掲載期限の入力）。
 * @param s - 確かめる文字列
 * @returns 実在する日付なら true
 */
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

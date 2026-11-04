// 解析のテストの材料（specs/022-algorithm-analysis tasks.md）。
import type { AnalysisPost } from "../../src";

/**
 * 日本時間の日時を ISO 8601 にする。
 * @param ymd - 日付
 * @param hour - 時（日本時間）
 * @returns ISO 8601
 */
export const jst = (ymd: string, hour: number) => new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString();

/**
 * 投稿1件。
 * @param over - 変えるところ
 * @returns 投稿
 */
export function post(over: Partial<AnalysisPost> = {}): AnalysisPost {
  return {
    id: over.id ?? "p",
    body: "今日の気づき",
    publishedAt: jst("2026-10-07", 12),
    views: 100,
    likes: 5,
    replies: 1,
    reposts: 0,
    quotes: 0,
    followersAtPost: 100,
    h24Views: 60,
    openingType: null,
    themeId: null,
    promo: false,
    ...over,
  };
}

const HOURS = [7, 12, 17, 21];

/**
 * 夜（20〜23時）の投稿の閲覧を高めにした投稿の並び（平日・2026-08-03から1日1件）。
 * @param n - 件数
 * @param over - 投稿ごとに変えるところ
 * @returns 投稿
 */
export function makePosts(n: number, over: (i: number) => Partial<AnalysisPost> = () => ({})): AnalysisPost[] {
  const out: AnalysisPost[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2026, 7, 3 + i));
    const ymd = day.toISOString().slice(0, 10);
    const hour = HOURS[i % HOURS.length]!;
    const night = hour === 21;
    out.push(
      post({
        id: `p${i}`,
        body: `投稿${i}の本文です`,
        publishedAt: jst(ymd, hour),
        views: night ? 400 + (i % 5) * 10 : 200 + (i % 5) * 10,
        h24Views: night ? 200 : 120,
        ...over(i),
      }),
    );
  }
  return out;
}

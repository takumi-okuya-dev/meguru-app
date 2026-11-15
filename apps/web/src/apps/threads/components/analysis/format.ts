// 解析の画面の数の書き方（specs/022 contracts/ui-routes.md）。
import { formatRatio } from "@meguru/shared";

/**
 * 件数・閲覧などの数（小数は四捨五入、桁区切り）。
 * @param n - 数（なければ null）
 * @returns 「1,560」・「—」
 */
export const num = (n: number | null): string => (n === null ? "—" : Math.round(n).toLocaleString("ja-JP"));

/**
 * 割合（反応率・返信率）。
 * @param r - 割合（0〜1。なければ null）
 * @returns 「4.1%」・「—」
 */
export const pct = (r: number | null): string => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

/**
 * 倍率（広がり・後からの伸び・差）。
 * @param r - 倍率（なければ null）
 * @returns 「×4.3」・「—」
 */
export const times = (r: number | null): string => (r === null ? "—" : `×${formatRatio(r)}`);

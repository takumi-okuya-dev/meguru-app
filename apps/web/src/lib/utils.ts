import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind のクラス名をまとめる（重なるクラスは後のものを優先する）。
 * @param inputs - クラス名（条件付きのものを含む）
 * @returns まとめたクラス名
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

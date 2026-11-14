// 入力が止まってから値を使う（探す欄で、1文字ごとにAPIを呼ばないため）。
import { useEffect, useState } from "react";

/** 待つ時間（ミリ秒）。 */
export const SEARCH_DELAY_MS = 300;

/**
 * 値が変わってから少し待って、最後の値を返す。
 * @param value - 今の値
 * @param delay - 待つ時間（ミリ秒）
 * @returns 少し遅れた値
 */
export function useDebouncedValue<T>(value: T, delay = SEARCH_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

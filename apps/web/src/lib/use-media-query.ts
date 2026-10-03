// 画面幅の判定（docs/ui-design.md「5. 画面幅ごとの振る舞い」）。Tailwind の md・lg と同じ区切り。
import { useSyncExternalStore } from "react";

/** 768px以上（タブレット・PC）。 */
export const MD_QUERY = "(min-width: 768px)";
/** 1024px以上（PC・iPad横）。 */
export const LG_QUERY = "(min-width: 1024px)";

/**
 * メディアクエリに一致するかを返し、画面幅が変わったら再描画する。
 * matchMedia がない環境（テストの jsdom など）では、広い画面とみなして true を返す。
 * @param query - メディアクエリ
 * @returns 一致すれば true
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia?.(query);
      media?.addEventListener("change", onChange);
      return () => media?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? true,
    () => true,
  );
}

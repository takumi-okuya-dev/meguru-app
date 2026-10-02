// 配色（contracts/ui-routes.md「レイアウトの骨格」）。
// 既定はライト。ユーザーメニューで ライト／ダーク／OSに合わせる を切り替え、ブラウザに保存する。
// 読み込み直後のちらつきを防ぐため、index.html でも同じ規則で先に当てている。
import { useEffect, useState } from "react";

/** 選べる配色。system は OS の設定に従う。 */
export type Theme = "light" | "dark" | "system";

/** 選んだ配色を保存する localStorage のキー。index.html の先読みのスクリプトと同じ値にする。 */
export const THEME_STORAGE_KEY = "threads-grower-theme";
const THEMES: readonly Theme[] = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * 保存された配色を読む。保存されていない・壊れているときはライト（既定）。
 * @returns 選んでいる配色
 */
export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v && (THEMES as readonly string[]).includes(v) ? (v as Theme) : "light";
  } catch {
    return "light";
  }
}

/**
 * 選んでいる配色から、実際に使う配色を決める（system は OS の設定で決める）。
 * @param theme - 選んでいる配色
 * @returns light か dark
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * 配色を画面に当てる（html 要素の dark クラスを切り替える）。
 * @param theme - 選んでいる配色
 */
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

const listeners = new Set<(t: Theme) => void>();

/**
 * 配色を選ぶ。保存して画面に当て、使っている箇所に知らせる。
 * @param theme - 選ぶ配色
 */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 保存できなくても、この画面の配色は切り替える
  }
  applyTheme(theme);
  listeners.forEach((l) => l(theme));
}

/**
 * 選んでいる配色と、実際に使われている配色を返す。OS の設定の変化にも追従する。
 * @returns theme（選んでいる配色）、resolved（実際の配色）、setTheme（配色を選ぶ関数）
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(getStoredTheme()));

  useEffect(() => {
    const onChange = (t: Theme) => {
      setThemeState(t);
      setResolved(resolveTheme(t));
    };
    listeners.add(onChange);
    // 「OSに合わせる」のときは、OSの設定の変化に追従する
    const media = window.matchMedia?.(DARK_QUERY);
    const onSystem = () => {
      if (getStoredTheme() === "system") {
        applyTheme("system");
        setResolved(resolveTheme("system"));
      }
    };
    media?.addEventListener("change", onSystem);
    return () => {
      listeners.delete(onChange);
      media?.removeEventListener("change", onSystem);
    };
  }, []);

  return { theme, resolved, setTheme };
}

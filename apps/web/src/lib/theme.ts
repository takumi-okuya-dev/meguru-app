// 配色（contracts/ui-routes.md「レイアウトの骨格」）。
// 既定はライト。ユーザーメニューで ライト／ダーク／OSに合わせる を切り替え、ブラウザに保存する。
// 読み込み直後のちらつきを防ぐため、index.html でも同じ規則で先に当てている。
import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "threads-grower-theme";
const THEMES: readonly Theme[] = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v && (THEMES as readonly string[]).includes(v) ? (v as Theme) : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

const listeners = new Set<(t: Theme) => void>();

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 保存できなくても、この画面の配色は切り替える
  }
  applyTheme(theme);
  listeners.forEach((l) => l(theme));
}

/** 選んでいる配色と、実際に使われている配色（system を解決したもの） */
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

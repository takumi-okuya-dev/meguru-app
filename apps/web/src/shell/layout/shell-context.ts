// 画面の骨格（AppShell）と上部バー（PageHeader）の間で共有する状態
import { createContext, useContext, type ReactNode } from "react";

/** 画面の骨格が上部バーに渡す値。 */
export type ShellState = {
  /** サイドバーが画面の横に出ているか（1024px以上で、畳んでいない） */
  sidebarVisible: boolean;
  /** 1024px以上か（畳む・開くの操作の文言を切り替える） */
  isWide: boolean;
  /** サイドバーを開く（1024px以上は畳みを戻す、未満はドロワーを開く） */
  openSidebar: () => void;
  /** 上部バーの下に出すバナー（要再接続など） */
  banner: ReactNode;
};

/** 画面の骨格の状態。AppShell の外では、サイドバーなしとして扱う。 */
export const ShellContext = createContext<ShellState>({
  sidebarVisible: false,
  isWide: true,
  openSidebar: () => {},
  banner: null,
});

/**
 * 画面の骨格の状態を受け取る。
 * @returns 画面の骨格の状態
 */
export function useShell() {
  return useContext(ShellContext);
}

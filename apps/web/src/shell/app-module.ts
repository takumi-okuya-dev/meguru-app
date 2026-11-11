// アプリが外枠に渡すもの（specs/028-meguru-shell data-model.md 4、research.md R3）。
// 外枠はアプリのコードを読まない。各アプリが apps/<名前>/index.ts で AppModule を出し、組み立て（app-registry.ts）が一覧にして外枠に渡す。
import type { LucideIcon } from "lucide-react";
import { createContext, useContext, type ReactElement } from "react";
import type { RouteObject } from "react-router";

/** 設定の画面（/settings）に、アプリが足す項目。 */
export type SettingsSectionContribution = {
  /** どの区分に出すか（personal＝個人設定、operator＝運営） */
  group: "personal" | "operator";
  /** 区分の中の並び順（小さいほど上。外枠の項目と混ぜて並べる） */
  order: number;
  /** URLの一部（/settings/<slug>） */
  slug: string;
  label: string;
  Icon: LucideIcon;
  /** 検索で引っかける語 */
  keywords: string[];
  /** 項目の画面 */
  element: ReactElement;
};

/** アプリの入口（外枠が使うのはこれだけ）。 */
export type AppModule = {
  /** アプリのID（PR3 で @meguru/shared のアプリの一覧の ID とそろえる） */
  id: string;
  /** 画面のURLの頭（例：/threads。PR2 で Threads の画面をこの下へ移す） */
  basePath: string;
  /** ログインの要るルート */
  routes: RouteObject[];
  /** ログインのいらないルート（サイドバーの外） */
  publicRoutes?: RouteObject[];
  /** ログインのいらない読みもののルート（環境の帯つきの入れ物に入れる） */
  readingRoutes?: RouteObject[];
  /** 設定の画面に足す項目 */
  settingsSections?: SettingsSectionContribution[];
};

const AppRegistryContext = createContext<readonly AppModule[]>([]);

/** 組み立てから外枠へ、出せるアプリの一覧を渡す。 */
export const AppRegistryProvider = AppRegistryContext.Provider;

/**
 * 出せるアプリの一覧を受け取る。
 * @returns アプリの一覧（渡されていなければ空）
 */
export function useAppRegistry(): readonly AppModule[] {
  return useContext(AppRegistryContext);
}

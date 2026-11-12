// アプリが外枠に渡すもの（specs/028-meguru-shell data-model.md 4、research.md R3）。
// 外枠はアプリのコードを読まない。各アプリが apps/<名前>/index.ts で AppModule を出し、組み立て（app-registry.ts）が一覧にして外枠に渡す。
import type { LucideIcon } from "lucide-react";
import { createContext, useContext, type ComponentType, type ReactElement } from "react";
import { useLocation, type RouteObject } from "react-router";

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

/** 前のURLと新しいURLの対応（頭を置き換える。specs/028 contracts/ui-routes.md 2）。 */
export type LegacyRedirect = { from: string; to: string };

/** アプリの入口（外枠が使うのはこれだけ）。 */
export type AppModule = {
  /** アプリのID（PR3 で @meguru/shared のアプリの一覧の ID とそろえる） */
  id: string;
  /** 画面のURLの頭（例：/threads。@meguru/shared の APP_CATALOG の basePath とそろえる） */
  basePath: string;
  /** アプリのアイコン（アプリの切り替え・すべてのアプリの画面） */
  icon: LucideIcon;
  /** すべてのアプリの画面の「使い始める」の行き先（Threadsならアカウントを作る画面） */
  startPath: string;
  /** ログインの要るルート */
  routes: RouteObject[];
  /** ログインのいらないルート（サイドバーの外） */
  publicRoutes?: RouteObject[];
  /** ログインのいらない読みもののルート（環境の帯つきの入れ物に入れる） */
  readingRoutes?: RouteObject[];
  /** 前のURLの転送（ログインの関所の外に作る） */
  legacyRedirects?: LegacyRedirect[];
  /** 設定の画面に足す項目 */
  settingsSections?: SettingsSectionContribution[];
  /** 退会の確かめで、このアプリについて見せる中身（なければ出さない。specs/meguru/029 contracts/module-boundaries.md 5） */
  withdrawalPreview?: {
    /** 中身を読む（TanStack Query の queryKey と queryFn） */
    query: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };
    /** 読んだ中身を出す部品 */
    Section: ComponentType<{ data: unknown }>;
  };
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

/**
 * URLから、今開いているアプリを決める（URLの頭が basePath と一致するアプリ）。
 * @param apps - 出せるアプリの入口
 * @param pathname - 今のURLのパス
 * @returns 開いているアプリ（どのアプリのパスでもなければ undefined）
 */
export function findCurrentApp(apps: readonly AppModule[], pathname: string): AppModule | undefined {
  const lower = pathname.toLowerCase();
  return apps.find((a) => lower === a.basePath || lower.startsWith(`${a.basePath}/`));
}

/**
 * 今開いているアプリを受け取る。
 * @returns 開いているアプリ（どのアプリのパスでもなければ undefined）
 */
export function useCurrentApp(): AppModule | undefined {
  return findCurrentApp(useAppRegistry(), useLocation().pathname);
}

/**
 * 紹介リンク・テスト用のグループの招待から入る人の行き先（登録の一覧の最初のアプリのホーム。今はThreads）。
 * すべてのアプリの画面を挟まずにアプリへ進める（specs/028 contracts/ui-routes.md 3）。外枠はアプリのパスを直に書かない。
 * @returns 行き先のパス（アプリがなければ入口の "/"）
 */
export function useEntryAppHome(): string {
  return useAppRegistry()[0]?.basePath ?? "/";
}

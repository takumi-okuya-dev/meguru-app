// 紹介リンク・招待など、外枠が「入口のアプリのホーム」を使う画面のテスト用の入れ物（specs/028-meguru-shell contracts/ui-routes.md 3）。
// アプリの画面を読みこまないよう、ホームのパスだけを持つ仮のThreadsを渡す（api-client のモックより先に読みこまれないように）。
import type { ReactNode } from "react";
import { AppRegistryProvider } from "@/shell/app-module";

/**
 * ホームが /threads のアプリを登録した中で描く。
 * @param props - children：中身
 * @returns 入れ物
 */
export function WithEntryApp({ children }: { children: ReactNode }) {
  return <AppRegistryProvider value={[{ id: "threads", basePath: "/threads", routes: [] }]}>{children}</AppRegistryProvider>;
}

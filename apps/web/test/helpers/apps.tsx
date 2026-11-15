// 設定の画面など、外枠がアプリの一覧を使う画面のテスト用の入れ物（specs/028-meguru-shell research.md R3）。
// 本番では組み立て（main.tsx）が AppRegistryProvider でアプリの一覧を渡す。テストでもThreadsを渡す。
import type { ReactNode } from "react";
import { threadsApp } from "@/apps/threads";
import { AppRegistryProvider } from "@/shell";

/**
 * Threadsを登録したアプリの一覧の中で描く。
 * @param props - children：中身
 * @returns 入れ物
 */
export function WithApps({ children }: { children: ReactNode }) {
  return <AppRegistryProvider value={[threadsApp]}>{children}</AppRegistryProvider>;
}

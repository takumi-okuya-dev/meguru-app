// 「ホームへ」の戻る先を、画面の枠から部品へ渡す（specs/028-meguru-shell research.md R1）。
// 共通の部品（使えない機能の案内など）は、どのアプリのホームかを知らないので、アプリの画面の枠がここに渡す。渡されていなければ入口（/）。
import { createContext, useContext } from "react";

const HomeLinkContext = createContext<string>("/");

/** 「ホームへ」の戻る先を渡す。値はアプリの画面の枠が決める（例：Threadsのアカウントのホーム）。 */
export const HomeLinkProvider = HomeLinkContext.Provider;

/**
 * 「ホームへ」の戻る先を受け取る。
 * @returns 戻る先のURL。渡されていなければ "/"
 */
export function useHomeLink(): string {
  return useContext(HomeLinkContext);
}

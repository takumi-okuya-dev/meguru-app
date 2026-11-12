// モジュール（アプリ）の登録を1回だけにする仕組み（specs/027-modular-monolith research.md R4）。
// 組み立てが何度 registerXxx() を呼んでも、アプリの登録（機能・上限・出来事の受け取り）は1回だけ行う。
// 029 の PR5 で platform/hooks.ts（共通 → アプリの知らせ）を消し、ここへ移した（specs/meguru/029-threads-pattern1 tasks.md T059）。

/** 登録を済ませたモジュール（registerModule で二重に登録しないため）。 */
const registeredModules = new Set<string>();

/**
 * モジュール（アプリ）の登録を、まとめて1回だけ行う。resetModules のあとは、また登録できる。
 * @param name - モジュールの名前（例：threads）
 * @param register - 登録をする関数
 */
export function registerModule(name: string, register: () => void): void {
  if (registeredModules.has(name)) return;
  // 登録が最後まで済んでから印を付ける（途中で例外になったら、次の呼び出しでもう一度試す。PR #98 のセルフレビュー）
  register();
  registeredModules.add(name);
}

/** 登録の記録をすべて消す（テスト用）。 */
export function resetModules(): void {
  registeredModules.clear();
}

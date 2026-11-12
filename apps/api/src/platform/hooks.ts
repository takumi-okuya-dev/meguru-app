// モジュール（アプリ）の登録を1回だけにする仕組み（specs/027-modular-monolith research.md R4）。
// 029 で、共通 → アプリの知らせ（runHook）は出来事（events/）に置き換え、呼び出しは0になった（specs/meguru/029 research.md R8）。
// 残るのは、組み立てが何度 registerXxx() を呼んでも1回だけ登録する registerModule だけ。PR5 で置き場所を見直す。

/** 登録を済ませたモジュール（registerModule で二重に登録しないため）。 */
const registeredModules = new Set<string>();

/**
 * モジュール（アプリ）の登録を、まとめて1回だけ行う。resetHooks のあとは、また登録できる。
 * @param name - モジュールの名前（例：threads）
 * @param register - 登録をする関数
 */
export function registerModule(name: string, register: () => void): void {
  if (registeredModules.has(name)) return;
  registeredModules.add(name);
  register();
}

/** 登録の記録をすべて消す（テスト用）。 */
export function resetHooks(): void {
  registeredModules.clear();
}

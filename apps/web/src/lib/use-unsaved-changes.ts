// 未保存の変更の警告（specs/002-strategy-profile FR-019、research.md R10）。
// React Router のブロッカーは同時に1つしか持てないので、ブロッカーは UnsavedChangesProvider に1つだけ置き、
// 各画面・ダイアログは「未保存の変更があるか」を登録するだけにする（課題の画面、宣伝投稿の割合、追加・編集のダイアログ）。
import { createContext, useContext, useEffect, useId } from "react";

/** 未保存の変更の登録先。 */
export type UnsavedRegistry = {
  /** id の未保存の変更の有無を登録する（false で取り消す） */
  set: (id: string, dirty: boolean) => void;
};

/** 未保存の変更の登録先。UnsavedChangesProvider の外では null（警告しない）。 */
export const UnsavedChangesContext = createContext<UnsavedRegistry | null>(null);

/**
 * 未保存の変更があることを登録する。登録がある間、画面・Account の移動とタブを閉じる操作を止めて確認する。
 * 「変更がある」は、入力値と最後に保存した値（または読み込んだ値）の比較で決めて渡す（元に戻したら変更なし）。
 * @param isDirty - 未保存の変更があるか
 */
export function useUnsavedChanges(isDirty: boolean): void {
  const registry = useContext(UnsavedChangesContext);
  const id = useId();
  useEffect(() => {
    registry?.set(id, isDirty);
    return () => registry?.set(id, false);
  }, [registry, id, isDirty]);
}

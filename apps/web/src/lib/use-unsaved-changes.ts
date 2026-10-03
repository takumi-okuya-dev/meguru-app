// 未保存の変更の警告（specs/002-strategy-profile FR-019、research.md R10）。
// アプリ内の移動は React Router の useBlocker で止め、タブを閉じる・再読み込みは beforeunload で止める。
import { useEffect } from "react";
import { useBlocker } from "react-router";

/** 止めた移動の状態と、続ける・やめるの操作。 */
export type UnsavedChanges = {
  /** 移動を止めていて、確認のダイアログを出す必要があるか */
  blocked: boolean;
  /** 変更を破棄して移動を続ける */
  proceed: () => void;
  /** 移動をやめて編集に戻る */
  reset: () => void;
};

/**
 * 未保存の変更がある間、画面・Account の移動とタブを閉じる操作を止める。
 * 「変更がある」は、入力値と最後に保存した値（または読み込んだ値）の比較で決めて渡す（元に戻したら変更なし）。
 * @param isDirty - 未保存の変更があるか
 * @returns 止めた移動の状態と操作
 */
export function useUnsavedChanges(isDirty: boolean): UnsavedChanges {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザでは returnValue の設定が必要
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // 変更がなくなったら（保存した・元に戻した）、止めていた移動を解く
  useEffect(() => {
    if (!isDirty && blocker.state === "blocked") blocker.reset();
  }, [isDirty, blocker]);

  return {
    blocked: blocker.state === "blocked",
    proceed: () => blocker.proceed?.(),
    reset: () => blocker.reset?.(),
  };
}

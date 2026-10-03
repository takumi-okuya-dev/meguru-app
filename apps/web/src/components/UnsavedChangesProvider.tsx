// 未保存の変更の警告の本体（specs/002 FR-019、contracts/ui-routes.md 規則3）。
// ブロッカーはここに1つだけ置き、登録された未保存の変更が1つでもあれば、移動とタブを閉じる操作を止める。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { UnsavedChangesContext, type UnsavedRegistry } from "@/lib/use-unsaved-changes";

/**
 * 未保存の変更の警告。Account の画面（AccountLayout）で中身を包む。
 * @param props - children：中身
 * @returns 中身と確認のダイアログ
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const registry = useMemo<UnsavedRegistry>(
    () => ({
      set: (id, dirty) =>
        setDirtyIds((prev) => {
          if (prev.has(id) === dirty) return prev;
          const next = new Set(prev);
          if (dirty) next.add(id);
          else next.delete(id);
          return next;
        }),
    }),
    [],
  );
  const anyDirty = dirtyIds.size > 0;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      anyDirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザでは returnValue の設定が必要
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  // 変更がなくなったら（保存した・元に戻した）、止めていた移動を解く
  useEffect(() => {
    if (!anyDirty && blocker.state === "blocked") blocker.reset();
  }, [anyDirty, blocker]);

  return (
    <UnsavedChangesContext.Provider value={registry}>
      {children}
      <UnsavedChangesDialog
        open={blocker.state === "blocked"}
        onStay={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
    </UnsavedChangesContext.Provider>
  );
}

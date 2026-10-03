// 下書きの削除を少し遅らせ、トーストの「元に戻す」で取り消せるようにする
// （specs/003 Clarifications 2026-10-04、contracts/ui-routes.md「下書きの削除」、research.md R9の追記）。
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { saveErrorMessage } from "@/lib/save-error";

/** 削除を確定するまでの時間（ミリ秒）。トーストの表示時間と同じ。 */
export const UNDO_WINDOW_MS = 5000;

type Pending = { ids: string[]; timer: ReturnType<typeof setTimeout>; toastId: string | number };

/**
 * 下書きの削除を遅らせて確定する。削除した下書きはすぐ一覧から隠し、UNDO_WINDOW_MS 後に API を呼ぶ。
 * 次の削除・画面を離れたときは、前の削除をその時点で確定する。
 * @param accountId - Account の ID
 * @returns hidden：一覧から隠す下書きのID、remove：削除する
 */
export function useDeferredDelete(accountId: string) {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef<Pending | null>(null);

  const unhide = useCallback((ids: string[]) => {
    setHidden((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  }, []);

  const commit = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    // 次の削除で前の削除を確定するときは、前のトーストの「元に戻す」も消す
    toast.dismiss(p.toastId);
    api.deletePostDrafts(accountId, p.ids).then(
      async () => {
        // 直近の下書きはプロンプトの材料なので、プロンプトも取り直す
        void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) });
        unhide(p.ids);
      },
      async (err: unknown) => {
        toast.error(saveErrorMessage(err));
        await queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) });
        unhide(p.ids);
      },
    );
  }, [accountId, queryClient, unhide]);

  // 画面を離れたら、待っている削除をその時点で確定する
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  useEffect(() => () => commitRef.current(), []);

  const remove = useCallback(
    (ids: string[]) => {
      commit();
      setHidden((prev) => new Set([...prev, ...ids]));
      const undo = () => {
        const p = pending.current;
        if (!p || p.ids !== ids) return;
        pending.current = null;
        clearTimeout(p.timer);
        unhide(ids);
      };
      const toastId = toast.success(`${ids.length}件の下書きを削除しました`, {
        duration: UNDO_WINDOW_MS,
        action: { label: "元に戻す", onClick: undo },
      });
      pending.current = { ids, timer: setTimeout(commit, UNDO_WINDOW_MS), toastId };
    },
    [commit, unhide],
  );

  return { hidden, remove };
}

// 下書きの削除を少し遅らせ、トーストの「元に戻す」で取り消せるようにする
// （specs/003 Clarifications 2026-10-04、contracts/ui-routes.md「下書きの削除」、research.md R9の追記）。
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";
import { saveErrorMessage } from "@/lib/save-error";

/** 削除を確定するまでの時間（ミリ秒）。トーストの表示時間と同じ。 */
export const UNDO_WINDOW_MS = 5000;

type Pending = { ids: string[]; timer: ReturnType<typeof setTimeout>; toastId: string | number };

// 画面をまたいでも、待っている削除の確定を待てるようにする（投稿ストックで削除してすぐ「投稿をつくる」で登録する流れ。
// PR #17 のCodexレビュー）。待っている削除を始める関数と、始まった確定の約束を、この場所に置く
const starters = new Set<() => Promise<void>>();
// 続けて削除すると確定が重なるので、始まった確定をすべて覚える（PR #17 のCodexレビュー）
const inFlight = new Set<Promise<void>>();

/**
 * 待っている削除をすぐ確定し、終わるまで待つ（画面を離れた後に始まった確定も待つ）。
 * @returns 確定が終わる約束
 */
export function flushPendingDeletes(): Promise<void> {
  // starters は呼ぶとその場で確定を始め、inFlight に入る
  const started = [...starters].map((start) => start());
  return Promise.all([...started, ...inFlight]).then(() => undefined);
}

/**
 * 下書きの削除を遅らせて確定する。削除した下書きはすぐ一覧から隠し、UNDO_WINDOW_MS 後に API を呼ぶ。
 * 次の削除・画面を離れたときは、前の削除をその時点で確定する。
 * @param accountId - Account の ID
 * @returns hidden：一覧から隠す下書きのID、remove：削除する、flush：待っている削除をすぐ確定し、終わるまで待つ
 */
export function useDeferredDelete(accountId: string) {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef<Pending | null>(null);

  const unhide = useCallback((ids: string[]) => {
    setHidden((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  }, []);

  const commit = useCallback((): Promise<void> => {
    const p = pending.current;
    if (!p) return Promise.resolve();
    pending.current = null;
    clearTimeout(p.timer);
    // 次の削除で前の削除を確定するときは、前のトーストの「元に戻す」も消す
    toast.dismiss(p.toastId);
    const done = threadsApi.deletePostDrafts(accountId, p.ids).then(
      async () => {
        // 直近の下書きはプロンプトの材料なので、プロンプトも取り直す
        void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.promptAll(accountId) });
        await queryClient.invalidateQueries({ queryKey: threadsQueryKeys.postDrafts(accountId) });
        unhide(p.ids);
      },
      async (err: unknown) => {
        toast.error(saveErrorMessage(err));
        await queryClient.invalidateQueries({ queryKey: threadsQueryKeys.postDrafts(accountId) });
        unhide(p.ids);
      },
    );
    inFlight.add(done);
    void done.finally(() => inFlight.delete(done));
    return done;
  }, [accountId, queryClient, unhide]);

  // 画面を離れたら、待っている削除をその時点で確定する
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  useEffect(
    () => () => {
      void commitRef.current();
    },
    [],
  );
  // ほかの画面からも、待っている削除を確定できるようにする
  useEffect(() => {
    const start = () => commitRef.current();
    starters.add(start);
    return () => {
      starters.delete(start);
    };
  }, []);

  const remove = useCallback(
    (ids: string[]) => {
      void commit();
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
      pending.current = { ids, timer: setTimeout(() => void commit(), UNDO_WINDOW_MS), toastId };
    },
    [commit, unhide],
  );

  return { hidden, remove, flush: commit };
}

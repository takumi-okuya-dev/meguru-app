// 1人の声かけの書き込み（始める・進める・消す）。誘う候補の行と人のページで同じものを使う（specs/people/001-people-memo contracts/api.md 5）。
import type { OutreachCreateInput, OutreachStage } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { peopleApi, type OutreachCreateResult } from "../../lib/api";
import { refreshOutreaches } from "../../lib/refresh";

/**
 * 声かけの書き込み。出すエラーは最後の操作のものだけ。どれかが書いている途中は pending。
 * @param options - locked：前の行を出したまま読み直している（押せなくする）、onStarted：始めたあと（同じ声かけがもうあれば created: false）、onRemoved：消したあと
 * @returns 書き込みと、押せない・エラーの状態
 */
export function useOutreachActions({
  locked = false,
  onStarted,
  onRemoved,
}: {
  locked?: boolean;
  onStarted?: (result: OutreachCreateResult) => void;
  onRemoved?: () => void;
} = {}) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: (input: OutreachCreateInput) => peopleApi.createOutreach(input),
    onSuccess: async (result) => {
      await refreshOutreaches(queryClient);
      onStarted?.(result);
    },
  });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: OutreachStage }) => peopleApi.updateOutreach(id, stage),
    onSuccess: () => refreshOutreaches(queryClient),
  });
  const remove = useMutation({
    mutationFn: (id: string) => peopleApi.deleteOutreach(id),
    onSuccess: async () => {
      onRemoved?.();
      await refreshOutreaches(queryClient);
    },
  });
  const all = [start, move, remove];
  /**
   * 1つの操作を始める前に、ほかの操作の結果（古いエラー）を消す。
   * @param keep - これから始める操作
   */
  const clearOthers = (keep: { reset: () => void }) => {
    for (const m of all) if (m !== keep) m.reset();
  };
  return {
    pending: locked || all.some((m) => m.isPending),
    failed: all.find((m) => m.isError),
    begin: (input: OutreachCreateInput) => {
      clearOthers(start);
      start.mutate(input);
    },
    setStage: (id: string, stage: OutreachStage) => {
      clearOthers(move);
      move.mutate({ id, stage });
    },
    drop: (id: string) => {
      clearOthers(remove);
      remove.mutate(id);
    },
  };
}

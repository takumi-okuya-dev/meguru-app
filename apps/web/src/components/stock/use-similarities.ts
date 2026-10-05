// 要確認の下書きの類似度を、ブラウザで計算する（specs/004-review-approval FR-026・FR-030、research.md R8）。
// 要確認が多いときは、画面の操作を止めないよう、アイドル時に分けて計算する。
import { computeSimilarities, type PostDraft, type SimilarityResult } from "@threads-grower/shared";
import { useEffect, useMemo, useState } from "react";

/** これを超える件数は、分けて計算する。 */
const SYNC_MAX = 100;
/** 1回に計算する要確認の件数。 */
const CHUNK = 50;

type Scheduler = (fn: () => void) => () => void;

const schedule: Scheduler = (fn) => {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn);
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
};

/**
 * 要確認の下書きの類似度。比べる相手は、同じAccountの全下書き（要確認・承認済み・却下）。
 * @param targets - 要確認の下書き
 * @param others - 比べる相手
 * @returns 下書きのID → 結果（計算が終わるまでは null）
 */
export function useSimilarities(
  targets: PostDraft[],
  others: PostDraft[],
): Map<string, SimilarityResult> | null {
  // 本文とIDだけで決まるので、それが変わったときだけ計算し直す
  const key = useMemo(
    () => JSON.stringify([targets.map((d) => [d.id, d.body]), others.map((d) => [d.id, d.body])]),
    [targets, others],
  );
  const sync = targets.length <= SYNC_MAX;
  // key が targets・others の中身を表すので、依存は key にする
  const syncResult = useMemo(
    () => (sync ? computeSimilarities(targets, others) : null),
    [key, sync],
  );
  const [asyncResult, setAsyncResult] = useState<{
    key: string;
    map: Map<string, SimilarityResult>;
  } | null>(null);

  useEffect(() => {
    if (sync) return;
    const acc = new Map<string, SimilarityResult>();
    let i = 0;
    let cancel = () => {};
    const step = () => {
      for (const [id, r] of computeSimilarities(targets.slice(i, i + CHUNK), others))
        acc.set(id, r);
      i += CHUNK;
      if (i < targets.length) cancel = schedule(step);
      else setAsyncResult({ key, map: acc });
    };
    cancel = schedule(step);
    return () => cancel();
  }, [key, sync]);

  if (sync) return syncResult;
  return asyncResult?.key === key ? asyncResult.map : null;
}

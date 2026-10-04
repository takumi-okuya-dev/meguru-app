// 承認・却下・要確認に戻すと、トーストの「元に戻す」（specs/004-review-approval FR-002〜FR-008、research.md R2）。
// 「元に戻す」は逆の操作を同じAPIで送る（承認・却下 → 要確認に戻す、要確認に戻す → 元の承認・却下）。
import { useQueryClient } from "@tanstack/react-query";
import type {
  PostDraft,
  RejectReasonCode,
  ReviewRequest,
  ReviewResponse,
  SkipReason,
} from "@threads-grower/shared";
import { useCallback } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { saveErrorMessage } from "@/lib/save-error";
import { SKIP_REASON_SHORT, skipMessage } from "./messages";

/** 「元に戻す」を出す時間（ミリ秒）。003の削除と同じ。 */
const UNDO_MS = 5000;

type Action = ReviewRequest["action"];

const DONE: Record<Action, string> = {
  approve: "承認しました",
  reject: "却下しました",
  reopen: "要確認に戻しました",
};
const DONE_N: Record<Action, (n: number) => string> = {
  approve: (n) => `${n}件を承認しました`,
  reject: (n) => `${n}件を却下しました`,
  reopen: (n) => `${n}件を要確認に戻しました`,
};
const FAILED: Record<Action, string> = {
  approve: "承認",
  reject: "却下",
  reopen: "要確認に戻すことが",
};

/** 状態を変える下書きの指定。 */
export type ReviewOptions = {
  /** 却下の理由（action が reject のとき） */
  reject?: { reasons: RejectReasonCode[]; note: string };
  /** 規約に注意の確認を済ませた（action が approve のとき） */
  confirmPolicyCaution?: boolean;
};

/**
 * まとめての操作の結果の文言。飛ばしたものがあれば、理由ごとの件数を添える。
 * @param action - 操作
 * @param res - レスポンス
 * @returns 文言
 */
function summary(action: Action, res: ReviewResponse): string {
  const counts = new Map<SkipReason, number>();
  for (const s of res.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const detail = [...counts].map(([r, n]) => `${SKIP_REASON_SHORT[r]} ${n}件`).join("・");
  return `${DONE_N[action](res.updated.length)}。${res.skipped.length}件は${FAILED[action]}できませんでした（${detail}）`;
}

/**
 * 下書きの状態を変える操作。成功したら一覧・件数・プロンプトを取り直し、トーストで「元に戻す」を出す。
 * @param accountId - Account の ID
 * @returns review：状態を変える（結果を返す。失敗したら null）
 */
export function useReview(accountId: string) {
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    // 件数（post-drafts/counts）は post-drafts の下のキーなので、一緒に取り直す
    void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) });
  }, [accountId, queryClient]);

  const send = useCallback(
    async (
      action: Action,
      drafts: PostDraft[],
      options: ReviewOptions,
    ): Promise<ReviewResponse | null> => {
      try {
        return await api.reviewPostDrafts(accountId, {
          action,
          items: drafts.map((d) => ({ id: d.id, expectedVersion: d.version })),
          ...(action === "reject" ? { reject: options.reject } : {}),
          ...(action === "approve" && options.confirmPolicyCaution
            ? { confirmPolicyCaution: true }
            : {}),
        });
      } catch (err) {
        toast.error(`${FAILED[action]}できませんでした。${saveErrorMessage(err)}`);
        return null;
      } finally {
        refresh();
      }
    },
    [accountId, refresh],
  );

  /** 「元に戻す」：逆の操作を送る。元に戻す操作には、さらに「元に戻す」を付けない。 */
  const undo = useCallback(
    async (action: Action, before: PostDraft[], updated: PostDraft[]) => {
      if (action !== "reopen") {
        await send("reopen", updated, {});
        return;
      }
      // 要確認に戻す前の状態ごとに、承認・却下（元の理由）を送り直す
      const latest = new Map(updated.map((d) => [d.id, d]));
      const approved = before
        .filter((d) => d.status === "approved" && latest.has(d.id))
        .map((d) => latest.get(d.id)!);
      // 直前に確認済みの承認を戻すだけなので、規約に注意の確認はもう一度求めない
      if (approved.length > 0) await send("approve", approved, { confirmPolicyCaution: true });
      const groups = new Map<
        string,
        { reject: { reasons: RejectReasonCode[]; note: string }; drafts: PostDraft[] }
      >();
      for (const d of before) {
        if (d.status !== "rejected" || !latest.has(d.id)) continue;
        const reject = { reasons: d.rejectReasons, note: d.rejectNote ?? "" };
        const key = JSON.stringify(reject);
        const g = groups.get(key) ?? { reject, drafts: [] };
        g.drafts.push(latest.get(d.id)!);
        groups.set(key, g);
      }
      for (const g of groups.values()) await send("reject", g.drafts, { reject: g.reject });
    },
    [send],
  );

  const review = useCallback(
    async (
      action: Action,
      drafts: PostDraft[],
      options: ReviewOptions = {},
    ): Promise<ReviewResponse | null> => {
      const res = await send(action, drafts, options);
      if (!res) return null;
      const changed = res.updated.filter(
        (u) => drafts.find((d) => d.id === u.id)?.status !== u.status,
      );
      const withUndo =
        changed.length > 0
          ? { action: { label: "元に戻す", onClick: () => void undo(action, drafts, changed) } }
          : {};
      if (res.skipped.length === 0) {
        toast.success(drafts.length === 1 ? DONE[action] : DONE_N[action](res.updated.length), {
          duration: UNDO_MS,
          ...withUndo,
        });
      } else if (drafts.length === 1) {
        toast.error(skipMessage(res.skipped[0]!.reason, action));
      } else {
        toast.warning(summary(action, res), { duration: UNDO_MS, ...withUndo });
      }
      return res;
    },
    [send, undo],
  );

  return { review };
}

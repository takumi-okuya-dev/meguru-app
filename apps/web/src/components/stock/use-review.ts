// 承認・却下・要確認に戻すと、トーストの「元に戻す」（specs/004-review-approval FR-002〜FR-008、research.md R2）。
// 「元に戻す」は逆の操作を同じAPIで送る（承認・却下 → 要確認に戻す、要確認に戻す → 元の承認・却下）。
import { useQueryClient } from "@tanstack/react-query";
import {
  REVIEW_MAX_ITEMS,
  type PostDraft,
  type RejectReasonCode,
  type ReviewRequest,
  type ReviewResponse,
  type SkipReason,
} from "@threads-grower/shared";
import { useCallback } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api-client";
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
  requeue: "もう一度投稿の順に入れました",
};
const DONE_N: Record<Action, (n: number) => string> = {
  approve: (n) => `${n}件を承認しました`,
  reject: (n) => `${n}件を却下しました`,
  reopen: (n) => `${n}件を要確認に戻しました`,
  requeue: (n) => `${n}件をもう一度投稿の順に入れました`,
};
const FAILED: Record<Action, string> = {
  approve: "承認",
  reject: "却下",
  reopen: "要確認に戻すことが",
  requeue: "投稿の順に入れることが",
};

/** 状態を変える下書きの指定。 */
export type ReviewOptions = {
  /** 却下の理由（action が reject のとき） */
  reject?: { reasons: RejectReasonCode[]; note: string };
  /** 規約に注意の確認を済ませた（action が approve のとき） */
  confirmPolicyCaution?: boolean;
};

/**
 * send の結果。res は返事を受け取れた分をまとめたもの（1件も受け取れなければ null）。
 * unsent は、サーバーが処理しなかったと確かな件数（入力の誤りなど、または、その後ろで送らなかった件数）。
 * unknown は、送り直しても返事を受け取れず、処理されたかどうかを確かめられなかった件数。error は最後の失敗の原因。
 */
type SendResult = { res: ReviewResponse | null; unsent: number; unknown: number; error: unknown };

/**
 * 通信の失敗などで、サーバーが処理したかどうか分からない失敗か（同じ操作IDで送り直して確かめる）。
 * @param err - 失敗の原因
 * @returns 処理されたかどうか分からないなら true（入力の誤りなど、処理されなかったと確かなら false）
 */
function isUncertain(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  // 4xx は、本文がJSONでなく INTERNAL_ERROR になった場合も含め、処理されなかったと確かな失敗（PR #5 のCodexレビュー）
  if (err.status >= 400 && err.status < 500) return false;
  return err.code === "API_UNREACHABLE" || err.status === 0 || err.status >= 500;
}

/**
 * 途中で失敗したときの、通知の最後に添える案内。結果が分からない分があれば、一覧を読み込み直した結果に応じて、状態を確かめるよう促す。
 * @param r - send の結果
 * @param listReloaded - 一覧の読み込み直しが成功したか
 * @returns 案内の文
 */
function incompleteNote(r: SendResult, listReloaded: boolean): string {
  if (r.unknown === 0) return saveErrorMessage(r.error);
  // 一覧の読み込み直しが終わってから伝える。失敗したら、終わったとは言わない（PR #5 のCodexレビュー）
  return listReloaded
    ? "一覧を読み込み直しました。それぞれの状態を確かめてから、必要ならもう一度操作してください。"
    : "一覧を読み込み直せませんでした。画面を再読み込みして、それぞれの状態を確かめてください。";
}

/** 結果が分からないときに、同じ操作IDで送り直す回数。 */
const UNCERTAIN_RETRIES = 2;

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

  /** 一覧・件数・プロンプトを取り直す。終わるまで待て、一覧を取り直せたかを返す。 */
  const refresh = useCallback(async (): Promise<boolean> => {
    // 件数（post-drafts/counts）は post-drafts の下のキーなので、一緒に取り直す
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) }),
    ]);
    return queryClient.getQueryState(queryKeys.postDrafts(accountId))?.status !== "error";
  }, [accountId, queryClient]);

  const send = useCallback(
    async (
      action: Action,
      drafts: PostDraft[],
      options: ReviewOptions,
    ): Promise<SendResult | null> => {
      // 1回のリクエストは REVIEW_MAX_ITEMS 件まで。NGワードの追加で要確認が500件を超えることがあるので、
      // それを超える選択は分けて順に送り、結果をまとめる（PR #5 のCodexレビュー）
      let merged: ReviewResponse | null = null;
      try {
        for (let i = 0; i < drafts.length; i += REVIEW_MAX_ITEMS) {
          const chunk = drafts.slice(i, i + REVIEW_MAX_ITEMS);
          const body = {
            action,
            // 操作ごとのID。結果が確定するまで同じIDを使う（APIは、同じIDの送り直しだけを成功として扱う。research.md R2）
            requestId: crypto.randomUUID(),
            items: chunk.map((d) => ({ id: d.id, expectedVersion: d.version })),
            ...(action === "reject" ? { reject: options.reject } : {}),
            ...(action === "approve" && options.confirmPolicyCaution
              ? { confirmPolicyCaution: true }
              : {}),
          };
          let res: ReviewResponse | null = null;
          let lastError: unknown = null;
          // 返事が来ない・サーバーのエラーのときは、処理されたかどうか分からないので、同じIDで送り直して確かめる。
          // 返事だけが失われていても、APIは自分の送り直しとして結果を返す（PR #5 のCodexレビュー）
          for (let attempt = 0; attempt <= UNCERTAIN_RETRIES; attempt++) {
            try {
              res = await api.reviewPostDrafts(accountId, body);
              break;
            } catch (err) {
              lastError = err;
              if (!isUncertain(err)) break;
            }
          }
          if (!res) {
            const rest = drafts.length - i - chunk.length;
            const uncertain = isUncertain(lastError);
            const failed = {
              res: merged,
              unsent: rest + (uncertain ? 0 : chunk.length),
              unknown: uncertain ? chunk.length : 0,
              error: lastError,
            };
            // 1つ目のまとまりで、処理されなかったと確かな失敗なら、何も変わっていないので失敗だけを伝える
            if (!merged && failed.unknown === 0) {
              toast.error(`${FAILED[action]}できませんでした。${saveErrorMessage(lastError)}`);
              return null;
            }
            return failed;
          }
          merged = merged
            ? {
                updated: [...merged.updated, ...res.updated],
                skipped: [...merged.skipped, ...res.skipped],
                counts: res.counts,
              }
            : res;
        }
        return merged && { res: merged, unsent: 0, unknown: 0, error: null };
      } finally {
        void refresh();
      }
    },
    [accountId, refresh],
  );

  /** 「元に戻す」で送る。途中で失敗したら、戻せなかった件数・確かめられなかった件数を伝える。 */
  const sendUndo = useCallback(
    async (action: Action, drafts: PostDraft[], options: ReviewOptions) => {
      const r = await send(action, drafts, options);
      if (!r || (r.unsent === 0 && r.unknown === 0)) return;
      const listReloaded = r.unknown > 0 ? await refresh() : true;
      const parts = [
        r.unknown > 0 ? `${r.unknown}件は元に戻せたかを確認できませんでした。` : "",
        r.unsent > 0 ? `${r.unsent}件を元に戻せませんでした。` : "",
      ].join("");
      toast.error(`${parts}${incompleteNote(r, listReloaded)}`);
    },
    [send, refresh],
  );

  /** 「元に戻す」：逆の操作を送る。元に戻す操作には、さらに「元に戻す」を付けない。 */
  const undo = useCallback(
    async (action: Action, before: PostDraft[], updated: PostDraft[]) => {
      if (action !== "reopen") {
        await sendUndo("reopen", updated, {});
        return;
      }
      // 要確認に戻す前の状態ごとに、承認・却下（元の理由）を送り直す
      const latest = new Map(updated.map((d) => [d.id, d]));
      const approved = before
        .filter((d) => d.status === "approved" && latest.has(d.id))
        .map((d) => latest.get(d.id)!);
      // 直前に確認済みの承認を戻すだけなので、規約に注意の確認はもう一度求めない
      if (approved.length > 0) await sendUndo("approve", approved, { confirmPolicyCaution: true });
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
      for (const g of groups.values()) await sendUndo("reject", g.drafts, { reject: g.reject });
    },
    [sendUndo],
  );

  const review = useCallback(
    async (
      action: Action,
      drafts: PostDraft[],
      options: ReviewOptions = {},
    ): Promise<ReviewResponse | null> => {
      const sent = await send(action, drafts, options);
      if (!sent) return null;
      const { unsent, unknown } = sent;
      const res = sent.res ?? {
        updated: [],
        skipped: [],
        counts: { needsReview: 0, approved: 0, rejected: 0, published: 0, publishFailed: 0 },
      };
      const changed = res.updated.filter(
        (u) => drafts.find((d) => d.id === u.id)?.status !== u.status,
      );
      // もう一度投稿の順に入れる（005）は、投稿に失敗には戻せないので「元に戻す」を付けない
      const withUndo =
        changed.length > 0 && action !== "requeue"
          ? { action: { label: "元に戻す", onClick: () => void undo(action, drafts, changed) } }
          : {};
      if (unsent > 0 || unknown > 0) {
        // 途中で失敗した：送れた分・確かめられなかった分・送れなかった分を、1つの通知で伝える。
        // 結果が分からない分があれば、一覧の読み込み直しが終わるのを待ってから伝える
        const listReloaded = unknown > 0 ? await refresh() : true;
        const parts = [
          res.updated.length > 0 ? `${DONE_N[action](res.updated.length)}。` : "",
          res.skipped.length > 0
            ? `${res.skipped.length}件は${FAILED[action]}できませんでした。`
            : "",
          unknown > 0 ? `${unknown}件は結果を確認できませんでした。` : "",
          unsent > 0 ? `${unsent}件は送れませんでした。` : "",
        ].join("");
        toast.warning(`${parts}${incompleteNote(sent, listReloaded)}`, {
          duration: UNDO_MS,
          ...withUndo,
        });
        return sent.res;
      } else if (res.skipped.length === 0) {
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
    [send, undo, refresh],
  );

  return { review };
}

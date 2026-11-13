// 受付の画面の状態（specs/collect/001-event-day-collection FR-031・FR-035・FR-037・FR-038、research.md R6、contracts/realtime.md）。
// 主催者の画面と手伝う人の画面で同じものを使う（呼び出しの先だけが違う）。
// - スナップショットを TanStack Query に持ち、知らせと自分の操作の応答で1行ずつ直す。版が「今の版＋1」でなければ読み直す。
// - 記録は押すたびに clientRequestId を作る。保存できなかった行は「保存できませんでした・もう一度送る」で残し、同じ clientRequestId で
//   送り直す（二重にならない）。保存できるまで、その行を受付済みに見せない（FR-037）。
import type {
  LiveMessage,
  LiveTicketResponse,
  ReceptionPerson,
  ReceptionSnapshot,
  RecordReceptionRequest,
  RecordReceptionResponse,
  WalkInRequest,
} from "@meguru/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-client";
import { collectErrorText } from "./errors";
import { collectQueryKeys } from "./query-keys";
import { useLive, type LiveStatus } from "./live";
import { withPerson, withRecord, type ReceptionViewer } from "./reception-model";

/** 受付の呼び出しの先（主催者か手伝う人）。 */
export type ReceptionSource = {
  queryKey: readonly unknown[];
  viewer: ReceptionViewer;
  snapshot: () => Promise<ReceptionSnapshot>;
  record: (personId: string, input: RecordReceptionRequest) => Promise<RecordReceptionResponse>;
  undo: (personId: string) => Promise<{ version: number }>;
  walkIn: (input: WalkInRequest) => Promise<{ person: ReceptionPerson; version: number }>;
  liveTicket: () => Promise<LiveTicketResponse>;
  // リンクが止められた（手伝う人）
  onLinkStopped?: () => void;
};

/** 保存の途中・保存できなかった記録。 */
export type PendingRecord = { status: "saving" | "failed"; input: RecordReceptionRequest };

/** 記録の入力（clientRequestId はここで作る）。 */
export type RecordChoice = Omit<RecordReceptionRequest, "clientRequestId">;

/**
 * 送り直してよい失敗か（APIに届かなかった・サーバーの不調）。入力の誤り・受付済みなどは送り直さない。
 * @param err - 捕まえたエラー
 * @returns 送り直してよいなら true
 */
function isRetryable(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
}

/**
 * 受付の画面の状態。
 * @param source - 呼び出しの先
 * @param enabled - 読んでよいか（手伝う人は参加のあと）
 * @returns スナップショット・会場の共有の状態・操作
 */
export function useReception(source: ReceptionSource, enabled = true) {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: source.queryKey,
    // 読んでいる間に知らせや自分の操作で新しい版を当てていたら、古いスナップショットで上書きしない
    queryFn: async () => {
      const fresh = await source.snapshot();
      const current = queryClient.getQueryData<ReceptionSnapshot>(source.queryKey);
      return current && current.version > fresh.version ? current : fresh;
    },
    enabled,
  });
  const [pending, setPending] = useState<Record<string, PendingRecord>>({});

  const resync = useCallback(() => void queryClient.invalidateQueries({ queryKey: source.queryKey }), [queryClient, source.queryKey]);

  /**
   * 新しい版の変更を当てる。持っている版より古い・同じなら何もしない（自分の操作の知らせがあとから届いたとき）。
   * 版が飛んだら（知らせの抜け）読み直す。
   */
  const apply = useCallback(
    (version: number, change: (snap: ReceptionSnapshot) => ReceptionSnapshot) => {
      let gap = false;
      queryClient.setQueryData<ReceptionSnapshot>(source.queryKey, (prev) => {
        if (!prev || version <= prev.version) return prev;
        if (version !== prev.version + 1) {
          gap = true;
          return prev;
        }
        return { ...change(prev), version };
      });
      if (gap) resync();
    },
    [queryClient, source.queryKey, resync],
  );

  // 受付の記録が変わったら、主催者のサイドバーの振込待ちの数（/api/collect/me）も読み直す（振込の記録・取り消しで変わる）
  const refreshMe = useCallback(() => {
    if (source.viewer.kind === "owner") void queryClient.invalidateQueries({ queryKey: collectQueryKeys.me });
  }, [queryClient, source.viewer.kind]);

  const onMessage = useCallback(
    (m: LiveMessage) => {
      switch (m.type) {
        case "reception.recorded":
          refreshMe();
          return apply(m.version, (s) => withRecord(s, m.personId, m.record, source.viewer));
        case "reception.undone":
          refreshMe();
          return apply(m.version, (s) => withRecord(s, m.personId, null, source.viewer));
        case "roster.changed":
          if (m.person) return apply(m.version, (s) => withPerson(s, m.person!, source.viewer));
          return resync();
        case "helpers.changed":
          return apply(m.version, (s) => ({ ...s, helpers: m.helpers }));
        case "link.stopped":
          source.onLinkStopped?.();
          return resync();
        case "resync":
          return resync();
      }
    },
    [apply, resync, refreshMe, source],
  );

  // 一度読めたら、あとの読み直しが失敗しても、つなぎ直しと15秒ごとの読み直しを続ける（止めると、APIが戻っても画面が追いつかない）
  const live: LiveStatus = useLive({
    enabled: enabled && snapshot.data !== undefined,
    helper: source.viewer.kind === "helper",
    getTicket: source.liveTicket,
    onMessage,
    onResync: resync,
  });

  const send = async (personId: string, input: RecordReceptionRequest) => {
    setPending((p) => ({ ...p, [personId]: { status: "saving", input } }));
    try {
      const res = await source.record(personId, input);
      apply(res.version, (s) => withRecord(s, personId, res.record, source.viewer));
      refreshMe();
      setPending(({ [personId]: _done, ...rest }) => rest);
    } catch (err) {
      if (isRetryable(err)) {
        setPending((p) => ({ ...p, [personId]: { status: "failed", input } }));
        return;
      }
      setPending(({ [personId]: _done, ...rest }) => rest);
      if (err instanceof ApiError && err.code === "ALREADY_RECORDED") {
        toast.info("この人は、ほかの人がもう受付しました。");
        resync();
        return;
      }
      toast.error(collectErrorText(err));
    }
  };

  return {
    snapshot,
    viewer: source.viewer,
    live,
    pending,
    // 記録する（押すたびに新しい clientRequestId）
    record: (personId: string, choice: RecordChoice) => send(personId, { ...choice, clientRequestId: crypto.randomUUID() }),
    // 保存できなかった記録を、同じ clientRequestId で送り直す
    retry: (personId: string) => {
      const p = pending[personId];
      if (p) void send(personId, p.input);
    },
    // 保存できなかった記録をやめる
    discard: (personId: string) => setPending(({ [personId]: _done, ...rest }) => rest),
    undo: async (personId: string) => {
      try {
        const { version } = await source.undo(personId);
        apply(version, (s) => withRecord(s, personId, null, source.viewer));
        refreshMe();
      } catch (err) {
        toast.error(collectErrorText(err));
        resync();
      }
    },
    // 飛び入りを足す。clientRequestId は呼ぶ側（ダイアログ）が1回の飛び入りに1つ作り、送り直しでも同じものを使う（二重にしない）
    walkIn: async (name: string, clientRequestId: string): Promise<boolean> => {
      try {
        const res = await source.walkIn({ name, clientRequestId });
        apply(res.version, (s) => withPerson(s, res.person, source.viewer));
        return true;
      } catch (err) {
        toast.error(collectErrorText(err));
        return false;
      }
    },
    resync,
  };
}

/** 受付の画面の状態（useReception の戻り値）。 */
export type ReceptionState = ReturnType<typeof useReception>;

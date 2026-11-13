// 会場の共有のつなぎ方（specs/collect/001-event-day-collection contracts/realtime.md 1・4、tasks.md T041）。
// 入場券を取って WebSocket につなぎ、知らせを渡す。つながったら・画面に戻ったら、スナップショットを読み直す。
// 切れたら1秒・2秒・4秒…（最大30秒）で入場券を取り直してつなぎ直し、つながらない間は15秒ごとに読み直す。
// リンクが止められた手伝う人の画面は、つなぎ直さない（主催者の画面は止めない）。
import type { LiveMessage, LiveTicketResponse } from "@meguru/shared";
import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, ApiError } from "@/lib/api-client";

/** 会場の共有の状態。 */
export type LiveStatus = "connecting" | "live" | "offline" | "stopped";

/** リンクを止めたときに、手伝う人の画面を閉じる理由の番号（API の LINK_STOPPED_CLOSE_CODE と同じ）。 */
const LINK_STOPPED_CLOSE_CODE = 4001;
/** つながらない間の読み直しの間隔。 */
export const OFFLINE_POLL_MS = 15_000;
/** つなぎ直しの待ちの上限。 */
const MAX_RETRY_MS = 30_000;

/**
 * 入場券から WebSocket のURLを作る。
 * @param ticket - 入場券
 * @returns URL
 */
export function liveUrl(ticket: string): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/api/collect/live?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * つなぎ直しまでの待ち（1秒・2秒・4秒…最大30秒）。
 * @param attempt - 何回目のつなぎ直しか（0から）
 * @returns 待ち（ミリ秒）
 */
export function retryDelay(attempt: number): number {
  return Math.min(MAX_RETRY_MS, 1000 * 2 ** attempt);
}

/**
 * 会場の共有につなぐ。
 * @param opts - enabled：つなぐか、helper：手伝う人の画面か（リンクが止められたら、つなぎ直さない）、getTicket：入場券を取る、
 *   onMessage：知らせを受けたとき、onResync：スナップショットを読み直すとき
 * @returns 状態
 */
export function useLive(opts: {
  enabled: boolean;
  helper?: boolean;
  getTicket: () => Promise<LiveTicketResponse>;
  onMessage: (message: LiveMessage) => void;
  onResync: () => void;
}): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;
    let disposed = false;
    let stopped = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const startPolling = () => {
      pollTimer ??= setInterval(() => latest.current.onResync(), OFFLINE_POLL_MS);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const stop = () => {
      stopped = true;
      stopPolling();
      setStatus("stopped");
    };
    const scheduleRetry = () => {
      if (disposed || stopped) return;
      setStatus("offline");
      startPolling();
      retryTimer = setTimeout(() => void connect(), retryDelay(attempt));
      attempt += 1;
    };
    const connect = async () => {
      let ticket: string;
      try {
        ticket = (await latest.current.getTicket()).ticket;
      } catch (err) {
        if (disposed) return;
        // リンクが止められた・期限が過ぎた（手伝う人）はつなぎ直さない
        if (err instanceof ApiError && err.code === "LINK_INACTIVE") return stop();
        return scheduleRetry();
      }
      if (disposed) return;
      const ws = new WebSocket(liveUrl(ticket));
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        stopPolling();
        setStatus("live");
        // つなぐまでの間の知らせを埋める
        latest.current.onResync();
      };
      ws.onmessage = (e) => {
        let message: LiveMessage;
        try {
          message = JSON.parse(String(e.data)) as LiveMessage;
        } catch {
          return;
        }
        latest.current.onMessage(message);
        // リンクを止めたこと（出し直しを含む）で止まるのは手伝う人の画面だけ。主催者の画面はつなぎ直しを続ける
        if (message.type === "link.stopped" && latest.current.helper) stopped = true;
      };
      ws.onclose = (e) => {
        if (socket === ws) socket = null;
        if (disposed) return;
        if (stopped || e.code === LINK_STOPPED_CLOSE_CODE) return stop();
        scheduleRetry();
      };
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") latest.current.onResync();
    };
    document.addEventListener("visibilitychange", onVisible);
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      stopPolling();
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    };
  }, [opts.enabled]);

  return status;
}

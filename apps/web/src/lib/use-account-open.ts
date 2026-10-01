// Accountの画面を開いたときの「最後に使ったAccount」の記録と接続の確認（FR-007・FR-018、規則5、research.md R10・R14）
// - clientId はページを読み込むたびに作り、メモリーだけに持つ（sessionStorage には保存しない）
// - openSeq はAccountの画面を開くたびに1つ増やす。再試行では最初の値をそのまま送る
// - 失敗したら指数バックオフで最大3回まで再試行し、それでも失敗したらウィンドウにフォーカスが戻ったときにもう一度呼ぶ
// - 画面を離れたら、待機中・実行中の再試行を中止する
// - ホバーなどの先読みでは呼ばない（このフックは画面を実際に開いたときだけ使う）
import type { AccountSummary } from "@threads-grower/shared";
import { useEffect, useRef } from "react";
import { ApiError, api } from "./api-client";

const pageClientId = crypto.randomUUID();
let pageOpenSeq = 0;

export const OPEN_RETRY_DELAYS_MS = [500, 1000, 2000];

export function useAccountOpen(
  accountId: string | undefined,
  onResult: (account: AccountSummary) => void,
  deps: { openAccount?: typeof api.openAccount; clientId?: string } = {},
) {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const openAccount = deps.openAccount ?? api.openAccount;
  const clientId = deps.clientId ?? pageClientId;

  useEffect(() => {
    if (!accountId) return;
    const openSeq = ++pageOpenSeq;
    const controller = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitingForFocus = false;

    const run = async () => {
      try {
        const account = await openAccount(accountId, { clientId, openSeq }, controller.signal);
        if (!controller.signal.aborted) onResultRef.current(account);
      } catch (err) {
        if (controller.signal.aborted) return;
        // 認証切れ・存在しないAccountは再試行しない（画面側で扱う）
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return;
        const delay = OPEN_RETRY_DELAYS_MS[attempt];
        attempt += 1;
        if (delay !== undefined) {
          timer = setTimeout(run, delay);
        } else {
          waitingForFocus = true;
        }
      }
    };

    const onFocus = () => {
      if (!waitingForFocus) return;
      waitingForFocus = false;
      attempt = 0;
      void run();
    };

    window.addEventListener("focus", onFocus);
    void run();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [accountId, clientId, openAccount]);
}

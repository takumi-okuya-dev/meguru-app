// APIのcallbackからのリダイレクトのクエリ（connected・error・account）を読み、トーストで表示してからURLから消す
// （contracts/ui-routes.md「callbackの結果表示」）。specs/012 で、画面の中に出すとき（silent）のために読んだ値を返すようにした。
import { connectedMessage, errorMessage, isErrorCode, type ErrorCode } from "@meguru/shared";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

/** callback の結果。最初の表示のときのクエリから読む（URLから消した後も変わらない）。 */
export type CallbackResult = {
  connected: string | null;
  error: ErrorCode | null;
  /** ACCOUNT_ALREADY_REGISTERED のとき、重なった自分のアカウント（specs/012 US3-1） */
  account: string | null;
};

/**
 * API の callback からのリダイレクトのクエリ（connected・error）を読み、トーストで表示してから URL から消す（contracts/ui-routes.md）。
 * @param opts - 文言に埋め込む値（アカウントの名前・ユーザー名・上限）。silent ならトーストを出さず、URLから消すだけ（画面の中に出すとき）
 * @returns 最初の表示のときに読み取った connected・error・account
 */
export function useCallbackResult(
  opts: { name?: string; username?: string | null; max?: number; silent?: boolean } = {},
): CallbackResult {
  const [params, setParams] = useSearchParams();
  const shown = useRef(false);
  const [captured] = useState<CallbackResult>(() => {
    const error = params.get("error");
    return {
      connected: params.get("connected"),
      error: error ? (isErrorCode(error) ? error : "INTERNAL_ERROR") : null,
      account: params.get("account"),
    };
  });
  const connected = params.get("connected");
  const error = params.get("error");

  useEffect(() => {
    if (shown.current || (!connected && !error)) return;
    if (connected && !opts.name && !opts.silent) return; // 表示に使うアカウントの名前が読み込まれるのを待つ
    shown.current = true;
    if (!opts.silent) {
      if (connected === "connect" || connected === "reconnect") {
        toast.success(connectedMessage(connected, opts.name ?? ""));
      } else if (error) {
        const code = isErrorCode(error) ? error : "INTERNAL_ERROR";
        toast.error(errorMessage(code, { max: opts.max, username: opts.username ?? undefined }).message);
      }
    }
    const next = new URLSearchParams(params);
    next.delete("connected");
    next.delete("error");
    next.delete("account");
    // トークンでの追加の権限の案内（specs/010）は、TokenWarnings が最初の表示で読み終えている
    next.delete("warn");
    setParams(next, { replace: true });
  }, [connected, error, opts, params, setParams]);

  return captured;
}

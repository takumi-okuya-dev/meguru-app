// APIのcallbackからのリダイレクトのクエリ（connected・error）を読み、トーストで表示してからURLから消す
// （contracts/ui-routes.md「callbackの結果表示」）
import { connectedMessage, errorMessage, isErrorCode } from "@threads-grower/shared";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

/**
 * API の callback からのリダイレクトのクエリ（connected・error）を読み、トーストで表示してから URL から消す（contracts/ui-routes.md）。
 * @param opts - 文言に埋め込む値（ユーザー名・上限）
 * @returns 読み取った connected と error
 */
export function useCallbackResult(opts: { username?: string; max?: number } = {}) {
  const [params, setParams] = useSearchParams();
  const shown = useRef(false);
  const connected = params.get("connected");
  const error = params.get("error");

  useEffect(() => {
    if (shown.current || (!connected && !error)) return;
    if (connected && !opts.username) return; // 表示に使うユーザー名が読み込まれるのを待つ
    shown.current = true;
    if (connected === "new" || connected === "updated" || connected === "reconnect") {
      toast.success(connectedMessage(connected, opts.username ?? ""));
    } else if (error) {
      const code = isErrorCode(error) ? error : "INTERNAL_ERROR";
      toast.error(errorMessage(code, opts).message);
    }
    const next = new URLSearchParams(params);
    next.delete("connected");
    next.delete("error");
    // トークンでの追加の権限の案内（specs/010）は、TokenWarnings が最初の表示で読み終えている
    next.delete("warn");
    setParams(next, { replace: true });
  }, [connected, error, opts, params, setParams]);

  return { connected, error: error && isErrorCode(error) ? error : error ? ("INTERNAL_ERROR" as const) : null };
}

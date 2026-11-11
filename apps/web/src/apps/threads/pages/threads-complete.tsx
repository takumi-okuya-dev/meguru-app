// Threads から戻ってきた人を受け止めて、接続を完了する（セキュリティ監査 run-1）。
//
// 以前は無認証の `GET /api/threads/callback` が接続まで済ませていた。state を作った人が
// 第三者にそれを踏ませると、踏んだ人の認可で発行されたトークンが作った人のアカウントに
// 保存されてしまうので、完了をログイン済みの POST に移した。この画面はそのPOSTを出すだけで、
// 行き先はサーバーが決める（以前 callback が組み立てていた判断をそのまま持ってきている）。
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CenteredLayout } from "@/components/layout/AppShell";
import { api } from "@/lib/api-client";

/**
 * サーバーが返した行き先が、このアプリの中の相対パスかを確かめる。
 * `//` で始まるものは外部のURLになるので弾く。
 * @param to - サーバーが返した行き先
 * @returns 使ってよければ true
 */
const isInsideApp = (to: string) => to.startsWith("/") && !to.startsWith("//");

/**
 * 接続の完了の画面。
 * @returns 画面
 */
export function ThreadsComplete() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sent = useRef(false);

  const state = params.get("state");
  const code = params.get("code");
  // 利用者が許可しなかったときなどは、callback が理由だけを付けて戻してくる
  const cancelled = params.get("error");

  const complete = useMutation({
    mutationFn: () =>
      // 許可しなかったときも state を渡す（元のアカウントの画面へ戻すため）
      cancelled
        ? api.completeConnect({ state: state!, error: "THREADS_AUTH_CANCELLED" })
        : api.completeConnect({ state: state!, code: code! }),
    onSuccess: ({ redirectTo }) => {
      // 履歴に残さない（戻るボタンで、使い終わった state と code の付いたURLに戻らないように）
      navigate(isInsideApp(redirectTo) ? redirectTo : "/", { replace: true });
    },
    onError: () => {
      navigate(`/?${new URLSearchParams({ error: "OAUTH_STATE_INVALID" })}`, { replace: true });
    },
  });

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // 許可しなかったとき：state があれば元の画面へ戻せるのでサーバーに聞く
    if (cancelled) {
      if (state) complete.mutate();
      else navigate(`/?${new URLSearchParams({ error: cancelled })}`, { replace: true });
      return;
    }
    if (!state || !code) {
      navigate(`/?${new URLSearchParams({ error: "THREADS_AUTH_FAILED" })}`, { replace: true });
      return;
    }
    complete.mutate();
  }, [cancelled, code, complete, navigate, state]);

  return (
    <CenteredLayout>
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">Threadsにつないでいます</h1>
        <p className="text-sm text-muted-foreground">そのままお待ちください。</p>
      </div>
    </CenteredLayout>
  );
}

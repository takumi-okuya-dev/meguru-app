// トークンの貼り付け（specs/010-token-account-add contracts/ui-routes.md、FR-002・FR-003・FR-051）。
// 追加の画面と、接続し直しのダイアログで共用する。トークンの値はこの部品の中だけで持ち、保存しない。
import { useMutation } from "@tanstack/react-query";
import { cleanToken, errorMessage, isTokenShaped, type TokenConnectResponse } from "@threads-grower/shared";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api, describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** 追加の画面と同じ、トークンの作り方の短い手順（contracts/ui-routes.md）。 */
export const TOKEN_STEPS = [
  "Metaの開発者サイトで、自分のアプリを作る（Threadsの使い方を選ぶ）",
  "権限に「threads_basic」「threads_content_publish」「threads_manage_insights」を加える",
  "自分のThreadsアカウントをテスターに加え、Threadsのアプリで招待を承認する",
  "「ユーザートークン生成ツール」で、長期トークンを作ってコピーする",
  "下の欄に貼り付けて「追加する」を押す",
];

type Props =
  | { mode: "new"; onSuccess: (result: TokenConnectResponse) => void }
  | { mode: "reconnect"; accountId: string; username: string; onSuccess: (result: TokenConnectResponse) => void };

/**
 * 権限がないものを、移った先の画面で案内するためのクエリの値にする（contracts/ui-routes.md 6）。
 * @param warnings - 応答の warnings
 * @returns warn の値（なければ空）
 */
export function warnParam(warnings: TokenConnectResponse["warnings"]): string {
  return warnings.map((w) => (w === "no_publish_permission" ? "publish" : "insights")).join(",");
}

/**
 * トークンの貼り付けの部品。手順・詳しい手順・入力欄・説明・送信・エラーを出す。
 * @param props - mode（new／reconnect）、接続し直すAccountとユーザー名、成功したときの動き
 * @returns 部品
 */
export function TokenConnectForm(props: Props) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [shapeError, setShapeError] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  const submit = useMutation({
    mutationFn: (token: string) =>
      api.tokenConnect(props.mode === "new" ? { mode: "new", token } : { mode: "reconnect", accountId: props.accountId, token }),
    onSuccess: (result) => {
      setValue("");
      props.onSuccess(result);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "TOKEN_CHECK_LOCKED") {
        setLockedUntil(Date.now() + Number(err.details[0] ?? 60) * 1000);
      }
    },
  });

  // 待ちの時間が過ぎたら、ボタンを戻す
  useEffect(() => {
    if (lockedUntil === null) return;
    const t = setTimeout(() => setLockedUntil(null), Math.max(0, lockedUntil - Date.now()));
    return () => clearTimeout(t);
  }, [lockedUntil]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = cleanToken(value);
    if (!isTokenShaped(token)) {
      setShapeError(true);
      return;
    }
    setShapeError(false);
    submit.mutate(token);
  };

  const err = submit.error;
  const code = err instanceof ApiError ? err.code : null;
  let message: string | null = null;
  if (err) {
    if (code === "TOKEN_CHECK_LOCKED") {
      message = errorMessage(code, { minutes: Math.ceil(Number(err instanceof ApiError ? err.details[0] : 60) / 60) }).message;
    } else if (code === "RECONNECT_ACCOUNT_MISMATCH" && props.mode === "reconnect") {
      message = errorMessage(code, { username: props.username, method: "token" }).message;
    } else {
      message = describeError(err);
    }
  }
  const registeredId = code === "ACCOUNT_ALREADY_REGISTERED" && err instanceof ApiError ? err.details[0] : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground/80">
        {TOKEN_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <a className="text-sm underline underline-offset-4" href="/guide/threads-token" target="_blank" rel="noreferrer">
        詳しい手順を見る
      </a>

      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          アクセストークン
        </label>
        <div className="flex gap-2">
          {/* パスワード欄にしない：ブラウザやパスワード管理ツールにトークンを保存させないため（FR-003、research.md R10） */}
          <Input
            id={inputId}
            type="text"
            name="threads-access-token"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            className={cn("font-mono", !visible && "token-masked")}
          />
          <Button type="button" variant="outline" onClick={() => setVisible((v) => !v)}>
            {visible ? "隠す" : "表示"}
          </Button>
        </div>
        {shapeError && <p className="text-sm text-destructive">トークンの形ではないようです</p>}
        <p className="text-xs text-muted-foreground">周りに人がいないところで貼り付けてください。</p>
      </div>

      <p className="text-xs text-muted-foreground">
        トークンは暗号化して保存し、画面に二度と表示しません。このアプリは、あなたの代わりに、このThreadsアカウントの投稿と、プロフィール・反応数の取得のためだけに使います。{" "}
        <a className="underline" href="/terms" target="_blank" rel="noreferrer">
          利用規約
        </a>
      </p>

      {message && (
        <Alert variant="destructive">
          <AlertDescription className="space-y-1 text-foreground">
            <p>{message}</p>
            {registeredId && (
              <Link className="underline" to={`/accounts/${registeredId}/settings`}>
                そのアカウントの設定を開く
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full rounded-full" disabled={submit.isPending || lockedUntil !== null}>
        {props.mode === "new" ? "追加する" : "接続し直す"}
      </Button>
    </form>
  );
}

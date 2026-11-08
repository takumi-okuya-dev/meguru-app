// つなぐ画面の招待の申し込み（specs/024-tester-invite-connect contracts/ui-routes.md 2、モック2〜4枚目）。
// 招待の管理がONのとき、「Threadsで許可する」の場所に出す。申し込み前・申し込み中・招待済み・見送りの4つ。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeThreadsUsername } from "@threads-grower/shared";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { ThreadsAccountGuide } from "./ThreadsAccountGuide";

/** 招待を承認する手順（Threadsのアプリの画面の名前が変わったら直す。docs/threads-token-guide.md と同じ考え方）。 */
export const APPROVE_STEPS = [
  "Threadsのアプリで、設定 › アカウント › ウェブサイトのアクセス許可 › 招待 を開く",
  "招待を承認する",
  "下の「Threadsで許可する」を押す",
] as const;

/**
 * 招待の申し込みの区分。
 * @param props - accountId：つなぐアカウント、allowButton：「Threadsで許可する」（招待済みのときだけ出す）、
 *   authFailed：許可の画面から失敗で戻ってきた、renderError：今のエラーの表示（使うべきアカウントを渡す。specs/025）
 * @returns 区分
 */
export function TesterApplicationPanel({
  accountId,
  allowButton,
  authFailed,
  renderError,
}: {
  accountId: string;
  allowButton: ReactNode;
  authFailed: boolean;
  renderError: (expected: string | null) => ReactNode;
}) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.testerApplication(accountId), queryFn: () => api.testerApplication(accountId) });
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.testerApplication(accountId) });
  const cancel = useMutation({ mutationFn: () => api.cancelTesterApplication(accountId), onSettled: refresh });

  if (q.isPending) return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-muted-foreground">{describeError(q.error)}</p>;
  const application = q.data.application;
  const status = application?.status;
  const cancelButton = (
    <Button variant="ghost" className="-ml-4 self-start" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
      申し込みを取り消す
    </Button>
  );
  const cancelError = cancel.isError && <p role="alert" className="text-sm text-destructive">{describeError(cancel.error)}</p>;

  if (status === "pending") {
    return (
      <div className="space-y-4">
        {renderError(null)}
        <div className="flex flex-col gap-1.5 rounded-2xl border bg-card px-4 py-3.5">
          <span className="text-xs text-muted-foreground">申し込み中</span>
          <span className="font-semibold">@{application!.threadsUsername}</span>
          <span className="text-sm text-muted-foreground">運営者の招待をお待ちください。</span>
          {cancelButton}
        </div>
        {cancelError}
      </div>
    );
  }

  if (status === "invited") {
    return (
      <div className="space-y-4">
        {/* キャンセル・失敗で戻ったら承認の案内。ほかのエラー（別の人が登録済みなど）は、そのまま出す（PR #71 のセルフレビュー） */}
        {authFailed ? (
          <Alert>
            <AlertDescription>招待を承認してから、もう一度お試しください。</AlertDescription>
          </Alert>
        ) : (
          renderError(application!.threadsUsername)
        )}
        <div className="space-y-3 rounded-2xl border bg-card px-4 py-3.5">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">招待済み</span>
            <span className="font-semibold">@{application!.threadsUsername}</span>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            {APPROVE_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        {allowButton}
        {/* 申し込んだアカウントで許可してもらう（specs/025 US1） */}
        <ThreadsAccountGuide expected={application!.threadsUsername} />
        <Alert>
          <AlertDescription>つなげなかったときは、招待を承認してから、もう一度お試しください。</AlertDescription>
        </Alert>
        <div className="flex flex-col">{cancelButton}</div>
        {cancelError}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {renderError(null)}
      {status === "declined" ? (
        <div className="flex flex-col gap-1 rounded-2xl border bg-card px-4 py-3.5">
          <span className="text-sm font-medium">今回は招待を見送りました</span>
          {application!.declineReason ? <span className="text-sm text-muted-foreground">{application!.declineReason}</span> : null}
        </div>
      ) : null}
      <ApplyForm
        accountId={accountId}
        initial={status === "declined" ? application!.threadsUsername : ""}
        submitLabel={status === "declined" ? "もう一度申し込む" : "招待を申し込む"}
        onApplied={refresh}
      />
    </div>
  );
}

/**
 * ユーザー名の欄と申し込むボタン。
 * @param props - accountId、initial：初めの値、submitLabel：ボタン、onApplied：申し込めたとき
 * @returns フォーム
 */
function ApplyForm({
  accountId,
  initial,
  submitLabel,
  onApplied,
}: {
  accountId: string;
  initial: string;
  submitLabel: string;
  onApplied: () => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const applyM = useMutation({ mutationFn: (raw: string) => api.applyTester(accountId, raw), onSuccess: onApplied });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!normalizeThreadsUsername(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    applyM.mutate(value);
  };
  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          Threadsのユーザー名
        </label>
        <Input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="@username"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          className="h-10 rounded-full px-4 md:h-9"
        />
        {invalid ? <p className="text-sm text-destructive">Threadsのユーザー名を確かめてください</p> : null}
        <p className="text-sm text-muted-foreground">運営者がテスターに招待したあと、つなげます。</p>
      </div>
      <Button type="submit" disabled={applyM.isPending}>
        {submitLabel}
      </Button>
      {applyM.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {describeError(applyM.error)}
        </p>
      ) : null}
    </form>
  );
}

// 未接続のアカウントの「Threadsとの接続」（specs/012 US2・US3、contracts/ui-routes.md「Threadsとの接続」）。
// 「Threadsで許可する」（このアプリの接続）と、開くと出る「自分のMetaアプリのトークンでつなぐ」の2つ（specs/010 の見せ方）。
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  TESTER_NOTICE,
  errorMessage,
  isAccountSwitchError,
  type AccountSummary,
  type ErrorCode,
  type TokenConnectResponse,
} from "@meguru/shared";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ConnectionBadge } from "@/apps/threads/components/ConnectionBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { AccountSwitchSteps } from "./AccountSwitchSteps";
import { TesterApplicationPanel } from "./TesterApplicationPanel";
import { ThreadsAccountGuide } from "./ThreadsAccountGuide";
import { TokenConnectForm } from "./TokenConnectForm";

/** 許可の画面から戻ってきたときのエラー（?error=…&account=…）。 */
export type ConnectError = { code: ErrorCode; account: string | null };

/**
 * 重なった自分のアカウントの案内（US3-1）。名前は自分のアカウントの一覧から引く。
 * @param props - accountId：重なったアカウント、message：文言、name：名前、steps：切り替えの手順（specs/025）
 * @returns 案内
 */
function RegisteredAlert({
  accountId,
  message,
  name,
  steps = null,
}: {
  accountId: string;
  message: string;
  name: string | null;
  steps?: React.ReactNode;
}) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="space-y-1 text-foreground">
        <p>{message}</p>
        <Link className="underline" to={`/threads/accounts/${accountId}/settings`}>
          {name ? `『${name}』を開く` : "そのアカウントの設定を開く"}
        </Link>
        {steps}
      </AlertDescription>
    </Alert>
  );
}

/**
 * 未接続のアカウントをThreadsにつなぐ区分の中身。オーナー以外には案内だけを出す（FR-015）。
 * @param props - account：未接続のアカウント、canConnect：オーナーか、initialError：許可の画面から戻ってきたときのエラー、
 *   onConnected：トークンでつながったとき（権限の案内を渡す）
 * @returns 区分の中身
 */
export function ConnectMethods({
  account,
  canConnect,
  initialError,
  onConnected,
}: {
  account: AccountSummary;
  canConnect: boolean;
  initialError: ConnectError | null;
  onConnected: (warnings: TokenConnectResponse["warnings"]) => void;
}) {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const [tokenOpen, setTokenOpen] = useState(false);
  const oauth = useMutation({
    mutationFn: () => api.connect({ mode: "connect", accountId: account.id }),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });

  if (!canConnect) {
    return (
      <div className="space-y-2">
        <ConnectionBadge status="not_connected" />
        <p className="text-sm text-muted-foreground">オーナーがThreadsにつなぐと使えます</p>
      </div>
    );
  }

  /**
   * 重なった自分のアカウント（自分のアカウントの一覧から引く）。
   * @param id - accounts.id
   * @returns アカウント。一覧になければNULL
   */
  const ownAccount = (id: string) => me.data?.accounts.find((a) => a.id === id) ?? null;
  /**
   * 許可の画面から戻ってきたエラー。取り違えで起きるエラーなら、切り替えの手順を添える（specs/025 US2・FR-006）。
   * @param expected - 使うべきアカウント（招待済みなら申し込んだ名前。決まっていなければ null）
   * @returns エラーの表示（なければ null）
   */
  const returned = (expected: string | null): React.ReactNode => {
    if (!initialError) return null;
    const steps = isAccountSwitchError(initialError.code) ? (
      <div className="pt-2">
        <AccountSwitchSteps expected={expected} again="Threadsで許可する" />
      </div>
    ) : null;
    const own = initialError.code === "ACCOUNT_ALREADY_REGISTERED" && initialError.account ? ownAccount(initialError.account) : null;
    return own && initialError.account ? (
      <RegisteredAlert
        accountId={initialError.account}
        name={own.name}
        message={errorMessage("ACCOUNT_ALREADY_REGISTERED", { details: [own.id, own.name, own.username ?? ""] }).message}
        steps={steps}
      />
    ) : (
      <Alert variant="destructive">
        <AlertDescription className="space-y-1 text-foreground">
          <p>{errorMessage(initialError.code).message}</p>
          {steps}
        </AlertDescription>
      </Alert>
    );
  };

  // 出す方法は環境の設定で決まる（既定は両方）。App Review を通すまで、または
  // 通らなかったときは token だけにできる
  const methods = me.data?.threadsConnectMethods ?? ["app", "token"];
  const showApp = methods.includes("app");
  const showToken = methods.includes("token");
  // OAuth を出さないときは、トークンの手順を最初から開いておく（唯一の方法なので畳まない）
  const tokenExpanded = tokenOpen || !showApp;
  // 招待の管理（specs/024 research.md R4）。/api/me を読むまでは出さない
  const invites = me.data?.testerInvites.enabled ?? false;
  const allow = (
    <>
      <Button disabled={oauth.isPending} onClick={() => oauth.mutate()}>
        Threadsで許可する
      </Button>
      {oauth.isError && (
        <Alert variant="destructive">
          <AlertDescription className="text-foreground">{describeError(oauth.error)}</AlertDescription>
        </Alert>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <ConnectionBadge status="not_connected" />
      <p className="text-sm text-muted-foreground">
        Threadsにつなぐと、承認した案を自動で投稿し、反応を分析できます。戦略・投稿ストック・設定は、つないでもそのまま残ります。
      </p>
      {!invites && returned(null)}
      {showApp && invites && (
        // 招待の管理がONなら、申し込み → 招待済みのときだけ「Threadsで許可する」を出す（specs/024 contracts/ui-routes.md 2）
        <TesterApplicationPanel
          accountId={account.id}
          allowButton={allow}
          authFailed={initialError?.code === "THREADS_AUTH_CANCELLED" || initialError?.code === "THREADS_AUTH_FAILED"}
          renderError={returned}
        />
      )}
      {showApp && !invites && (
        <>
          {allow}
          {/* 押す前に、threads.com でログインしているアカウントで許可されることを知らせる（specs/025 US1） */}
          <ThreadsAccountGuide expected={null} />
          {/* Meta App Review の前（テスターだけが接続できる間）だけ出す（specs/002 FR-028） */}
          {me.data?.threadsAccessMode === "testers" && (
            <Alert>
              <AlertDescription>{TESTER_NOTICE}</AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* 2つ目の方法（specs/010 FR-001）。開くまで手順と入力欄を出さない。
          OAuth を出さないときは、これが唯一の方法なので畳まない */}
      {showToken && (
      <div className={cn("space-y-4", showApp && "border-t pt-4")}>
        {showApp && (
        <button
          type="button"
          aria-expanded={tokenOpen}
          onClick={() => setTokenOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-medium"
        >
          自分のMetaアプリのトークンでつなぐ
          <ChevronDownIcon aria-hidden="true" className={cn("size-4 transition-transform", tokenOpen && "rotate-180")} />
        </button>
        )}
        {tokenExpanded && (
          <TokenConnectForm
            mode="connect"
            accountId={account.id}
            onSuccess={(result) => onConnected(result.warnings)}
            renderError={(err) => {
              // 自分の別のアカウントと重なったら、その名前とリンクを出す（US3-1）
              if (!(err instanceof ApiError) || err.code !== "ACCOUNT_ALREADY_REGISTERED" || !err.details[0]) return null;
              return <RegisteredAlert accountId={err.details[0]} name={err.details[1] ?? null} message={describeError(err)} />;
            }}
          />
        )}
      </div>
      )}
    </div>
  );
}

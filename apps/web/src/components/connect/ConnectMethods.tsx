// 未接続のアカウントの「Threadsとの接続」（specs/012 US2・US3、contracts/ui-routes.md「Threadsとの接続」）。
// 「Threadsで許可する」（このアプリの接続）と、開くと出る「自分のMetaアプリのトークンでつなぐ」の2つ（specs/010 の見せ方）。
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  TESTER_NOTICE,
  errorMessage,
  type AccountSummary,
  type ErrorCode,
  type TokenConnectResponse,
} from "@threads-grower/shared";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { TokenConnectForm } from "./TokenConnectForm";

/** 許可の画面から戻ってきたときのエラー（?error=…&account=…）。 */
export type ConnectError = { code: ErrorCode; account: string | null };

/**
 * 重なった自分のアカウントの案内（US3-1）。名前は自分のアカウントの一覧から引く。
 * @param props - accountId：重なったアカウント、message：文言、name：名前
 * @returns 案内
 */
function RegisteredAlert({ accountId, message, name }: { accountId: string; message: string; name: string | null }) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="space-y-1 text-foreground">
        <p>{message}</p>
        <Link className="underline" to={`/accounts/${accountId}/settings`}>
          {name ? `『${name}』を開く` : "そのアカウントの設定を開く"}
        </Link>
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
  let returned: React.ReactNode = null;
  if (initialError) {
    const own = initialError.code === "ACCOUNT_ALREADY_REGISTERED" && initialError.account ? ownAccount(initialError.account) : null;
    returned =
      own && initialError.account ? (
        <RegisteredAlert
          accountId={initialError.account}
          name={own.name}
          message={errorMessage("ACCOUNT_ALREADY_REGISTERED", { details: [own.id, own.name, own.username ?? ""] }).message}
        />
      ) : (
        <Alert variant="destructive">
          <AlertDescription className="text-foreground">{errorMessage(initialError.code).message}</AlertDescription>
        </Alert>
      );
  }

  return (
    <div className="space-y-4">
      <ConnectionBadge status="not_connected" />
      <p className="text-sm text-muted-foreground">
        Threadsにつなぐと、承認した案を自動で投稿し、反応を分析できます。戦略・投稿ストック・設定は、つないでもそのまま残ります。
      </p>
      {returned}
      <Button disabled={oauth.isPending} onClick={() => oauth.mutate()}>
        Threadsで許可する
      </Button>
      {oauth.isError && (
        <Alert variant="destructive">
          <AlertDescription className="text-foreground">{describeError(oauth.error)}</AlertDescription>
        </Alert>
      )}
      {/* Meta App Review の前（テスターだけが接続できる間）だけ出す（specs/002 FR-028） */}
      {me.data?.threadsAccessMode === "testers" && (
        <Alert>
          <AlertDescription>{TESTER_NOTICE}</AlertDescription>
        </Alert>
      )}

      {/* 2つ目の方法（specs/010 FR-001）。開くまで手順と入力欄を出さない */}
      <div className="space-y-4 border-t pt-4">
        <button
          type="button"
          aria-expanded={tokenOpen}
          onClick={() => setTokenOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-medium"
        >
          自分のMetaアプリのトークンでつなぐ
          <ChevronDownIcon aria-hidden="true" className={cn("size-4 transition-transform", tokenOpen && "rotate-180")} />
        </button>
        {tokenOpen && (
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
    </div>
  );
}

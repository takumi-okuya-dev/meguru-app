// Account設定（FR-013・FR-019・FR-020・FR-022、規則9・10）。004で「投稿のルール」の区分を、既存の区分より上に足した。
// 005で「投稿のスケジュール」の区分を、「投稿のルール」の上に足した
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SHORT_LIVED_TOKEN_HINT,
  accountLabel,
  connectedMessage,
  errorMessage,
  type TokenConnectResponse,
} from "@threads-grower/shared";
import { CheckCircle2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ConnectMethods } from "@/components/connect/ConnectMethods";
import { AccountNameSection } from "@/components/settings/AccountNameSection";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { PostingRulesSection } from "@/components/settings/PostingRulesSection";
import { PostingScheduleSection } from "@/components/settings/PostingScheduleSection";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, describeError } from "@/lib/api-client";
import { useCallbackResult } from "@/lib/callback-result";
import { takeInviteReturn } from "@/lib/invite-return";
import { queryKeys } from "@/lib/query";
import { useCurrentAccount } from "@/pages/account-layout";
import { TeamSection } from "@/components/team/TeamSection";
import { ReconnectDialog } from "@/components/connect/ReconnectDialog";
import { TokenWarnings } from "@/components/connect/TokenWarnings";
import { useAccountAccess } from "@/lib/use-account-access";

/**
 * Account の設定（FR-013・FR-019・FR-020・FR-022、規則9・10）。認可し直す操作と、確認つきの削除。
 * @returns Account の設定画面
 */
export function AccountSettings() {
  const account = useCurrentAccount();
  // callback の結果は、はじめてつないだとき・未接続のままのエラーは区分の中に出し、接続し直しはトーストで出す（specs/012）
  const callback = useCallbackResult({ silent: true });
  const notConnected = account.connectionStatus === "not_connected";
  // 関わりで出し分ける（specs/008 FR-041、specs/011 FR-060）。設定の操作は settings、接続・削除・チームに見せるは owner の権限
  const { access, can } = useAccountAccess(account.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  // 接続し直しは、このアプリで許可かトークンの貼り付けを選ぶダイアログから（specs/010 FR-031）
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [tokenWarnings, setTokenWarnings] = useState<TokenConnectResponse["warnings"]>([]);
  // つないだ直後の案内（はじめてつないだときだけ。specs/012 FR-014）と、「自動投稿を始める」で設定のダイアログを開く合図
  const [justConnected, setJustConnected] = useState(callback.connected === "connect");
  const [editRequest, setEditRequest] = useState(0);

  // 接続し直しの結果と、つながっているアカウントの接続のエラーは、今までどおりトーストで出す
  const toasted = useRef(false);
  useEffect(() => {
    if (toasted.current) return;
    toasted.current = true;
    if (callback.connected === "reconnect") toast.success(connectedMessage("reconnect", account.name));
    else if (callback.error && !notConnected)
      toast.error(errorMessage(callback.error, { username: account.username ?? undefined }).message);
  }, [callback, account.name, account.username, notConnected]);

  // 招待のリンクから来た人は、つないだら招待へ戻す（specs/011 T019、specs/012 research.md R7）
  useEffect(() => {
    if (!justConnected) return;
    const back = takeInviteReturn();
    if (back) void navigate(back, { replace: true });
  }, [justConnected, navigate]);

  /**
   * トークンでつながったとき：表示を読み直し、つないだ直後の案内を出す。
   * @param warnings - 権限がないものの案内
   */
  const onTokenConnected = async (warnings: TokenConnectResponse["warnings"]) => {
    setTokenWarnings(warnings);
    setJustConnected(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.account(account.id) }),
    ]);
  };

  const remove = useMutation({
    // 入力した値はそのまま送る（正規化はサーバーでも行う）
    mutationFn: () => api.deleteAccount(account.id, confirm),
    onSuccess: async () => {
      setOpen(false);
      queryClient.removeQueries({ queryKey: ["account", account.id] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      void navigate("/", { replace: true });
    },
  });

  const needsReconnect = account.connectionStatus === "needs_reconnect";
  // 削除の確認はアカウントの名前で（specs/012 FR-043）。前後の空白は問わない
  const confirmed = confirm.trim() !== "" && confirm.trim() === account.name;

  return (
    <>
      <PageHeader title="このアカウントの設定" />
      <PageBody className="space-y-10">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{accountLabel(account).primary}</span>
            {accountLabel(account).secondary && <span className="text-muted-foreground">{accountLabel(account).secondary}</span>}
            <ConnectionBadge status={account.connectionStatus} />
          </div>
        </section>

        {/* 一番上に、主に出す名前（オーナーだけ。specs/012 FR-040） */}
        {can("owner") && <AccountNameSection account={account} />}

        {/* つないだ直後の案内（specs/012 contracts/ui-routes.md「Threadsとの接続」） */}
        {justConnected && !notConnected && (
          <Alert role="status">
            <AlertDescription className="space-y-3 text-foreground">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2Icon aria-hidden="true" className="size-4" />
                {account.name}をThreadsにつなぎました{account.username ? `（@${account.username}）` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                自動投稿はオフのままです。投稿の時刻を決めてオンにすると、承認した案の投稿が始まります。
              </p>
              {can("settings") && (
                <Button className="rounded-full" onClick={() => setEditRequest((n) => n + 1)}>
                  自動投稿を始める
                </Button>
              )}
              <TokenWarnings warnings={tokenWarnings.map((w) => (w === "no_publish_permission" ? "publish" : "insights"))} />
            </AlertDescription>
          </Alert>
        )}

        <PostingScheduleSection
          account={account}
          canEdit={can("settings")}
          canReconnect={can("owner")}
          onReconnect={() => setReconnectOpen(true)}
          editRequest={editRequest}
        />

        <PostingRulesSection accountId={account.id} canEdit={can("settings")} />

        {notConnected ? (
          <section id="threads" className="space-y-3">
            <h2 className="font-medium">Threadsとの接続</h2>
            <ConnectMethods
              account={account}
              canConnect={can("owner")}
              initialError={callback.error ? { code: callback.error, account: callback.account } : null}
              onConnected={(warnings) => void onTokenConnected(warnings)}
            />
          </section>
        ) : can("owner") && (
        <section id="threads" className="space-y-3">
          <h2 className="font-medium">Threadsとの接続</h2>
          <p className="text-sm text-muted-foreground">
            今の接続：{account.connectionMethod === "token" ? "自分のMetaアプリのトークン" : "このアプリで許可"}。同じThreadsアカウント（@{account.username}）で接続し直すと、接続情報を更新できます。
          </p>
          {needsReconnect && account.reconnectHint === "short_lived_token" && (
            <Alert variant="warning">
              <AlertDescription className="text-foreground">{SHORT_LIVED_TOKEN_HINT}</AlertDescription>
            </Alert>
          )}
          {!justConnected && (
            <TokenWarnings warnings={tokenWarnings.map((w) => (w === "no_publish_permission" ? "publish" : "insights"))} />
          )}
          <Button variant={needsReconnect ? "default" : "outline"} onClick={() => setReconnectOpen(true)}>
            {needsReconnect ? "再接続" : "接続し直す"}
          </Button>
        </section>
        )}

        {access && <TeamSection accountId={account.id} access={access} />}

        {can("owner") && (
        <section className="space-y-3">
          <h2 className="font-medium text-destructive">Accountの削除</h2>
          <p className="text-sm text-muted-foreground">
            このAccountと、接続情報・関連するデータをすべて削除します。取り消せません。
          </p>
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) {
                setConfirm("");
                remove.reset();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="destructive">Accountを削除</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Accountを削除しますか？</DialogTitle>
                <DialogDescription>
                  この操作は取り消せません。確認のため、{account.name} と入力してください。
                  {/* 未接続ならトークンはないので出さない（specs/012 FR-043） */}
                  {account.connectionMethod === "token" && (
                    <span className="mt-1 block">Metaアプリ側のトークンは、必要なら自分で取り消してください。</span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={account.name}
                aria-label="確認のためのアカウントの名前"
                autoFocus
              />
              {remove.isError && (
                <p className="text-sm text-destructive">{describeError(remove.error)}</p>
              )}
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={!confirmed || remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  削除する
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
        )}
      </PageBody>
      {reconnectOpen && (
        <ReconnectDialog
          account={account}
          onClose={() => setReconnectOpen(false)}
          onTokenSuccess={(result) => setTokenWarnings(result.warnings)}
        />
      )}
    </>
  );
}

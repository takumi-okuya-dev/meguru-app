// Account設定（FR-013・FR-019・FR-020・FR-022、規則9・10）。004で「投稿のルール」の区分を、既存の区分より上に足した。
// 005で「投稿のスケジュール」の区分を、「投稿のルール」の上に足した
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SHORT_LIVED_TOKEN_HINT, normalizeUsername, type TokenConnectResponse } from "@threads-grower/shared";
import { useState } from "react";
import { useNavigate } from "react-router";
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
  useCallbackResult({ username: account.username });
  // 役割で出し分ける（specs/008 FR-041）。設定の操作は settings、接続・削除・パートナーは owner の権限
  const { access, can } = useAccountAccess(account.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  // 接続し直しは、このアプリで許可かトークンの貼り付けを選ぶダイアログから（specs/010 FR-031）
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [tokenWarnings, setTokenWarnings] = useState<TokenConnectResponse["warnings"]>([]);

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
  const confirmed =
    normalizeUsername(confirm) === normalizeUsername(account.username) && confirm.trim() !== "";

  return (
    <>
      <PageHeader title="このアカウントの設定" />
      <PageBody className="space-y-10">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span>@{account.username}</span>
            <ConnectionBadge status={account.connectionStatus} />
          </div>
        </section>

        <PostingScheduleSection
          account={account}
          canEdit={can("settings")}
          canReconnect={can("owner")}
          onReconnect={() => setReconnectOpen(true)}
        />

        <PostingRulesSection accountId={account.id} canEdit={can("settings")} />

        {can("owner") && (
        <section className="space-y-3">
          <h2 className="font-medium">Threadsとの接続</h2>
          <p className="text-sm text-muted-foreground">
            今の接続：{account.connectionMethod === "token" ? "自分のMetaアプリのトークン" : "このアプリで許可"}。同じThreadsアカウント（@{account.username}）で接続し直すと、接続情報を更新できます。
          </p>
          {needsReconnect && account.reconnectHint === "short_lived_token" && (
            <Alert variant="warning">
              <AlertDescription className="text-foreground">{SHORT_LIVED_TOKEN_HINT}</AlertDescription>
            </Alert>
          )}
          <TokenWarnings warnings={tokenWarnings.map((w) => (w === "no_publish_permission" ? "publish" : "insights"))} />
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
                  この操作は取り消せません。確認のため、@{account.username} と入力してください。
                  {account.connectionMethod === "token" && (
                    <span className="mt-1 block">Metaアプリ側のトークンは、必要なら自分で取り消してください。</span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={`@${account.username}`}
                aria-label="確認のためのユーザー名"
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

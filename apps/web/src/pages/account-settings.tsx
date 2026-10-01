// Account設定（FR-013・FR-019・FR-020・FR-022、規則9・10）
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { normalizeUsername } from "@threads-grower/shared";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ConnectionBadge } from "@/components/ConnectionBadge";
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

export function AccountSettings() {
  const account = useCurrentAccount();
  useCallbackResult({ username: account.username });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  const reconnect = useMutation({
    mutationFn: () => api.connect({ mode: "reconnect", accountId: account.id }),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });

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
  const confirmed = normalizeUsername(confirm) === normalizeUsername(account.username) && confirm.trim() !== "";

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">設定</h1>
        <div className="flex items-center gap-2 text-sm">
          <span>@{account.username}</span>
          <ConnectionBadge status={account.connectionStatus} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Threadsとの接続</h2>
        <p className="text-sm text-muted-foreground">
          同じThreadsアカウント（@{account.username}）で認可し直すと、接続情報を更新できます。
        </p>
        {reconnect.isError && (
          <Alert variant="destructive">
            <AlertDescription className="text-foreground">{describeError(reconnect.error)}</AlertDescription>
          </Alert>
        )}
        <Button
          variant={needsReconnect ? "default" : "outline"}
          disabled={reconnect.isPending}
          onClick={() => reconnect.mutate()}
        >
          {needsReconnect ? "再接続" : "Threadsとの接続を認可し直す"}
        </Button>
      </section>

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
              <DialogDescription>この操作は取り消せません。確認のため、@{account.username} と入力してください。</DialogDescription>
            </DialogHeader>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={`@${account.username}`}
              aria-label="確認のためのユーザー名"
              autoFocus
            />
            {remove.isError && <p className="text-sm text-destructive">{describeError(remove.error)}</p>}
            <DialogFooter>
              <Button variant="destructive" disabled={!confirmed || remove.isPending} onClick={() => remove.mutate()}>
                削除する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}

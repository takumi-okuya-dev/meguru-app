// 「接続し直す」のダイアログ（specs/010-token-account-add contracts/ui-routes.md、US3・FR-031）。
// このアプリで許可（001のOAuth）と、トークンの貼り付けの2つから選ぶ。オーナーだけが開ける（呼び出し側で出し分ける）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConnectionMethod, TokenConnectResponse } from "@threads-grower/shared";
import { ChevronRightIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TokenConnectForm } from "./TokenConnectForm";

/** 接続し直すAccount。 */
export type ReconnectTarget = { id: string; username: string; connectionMethod?: ConnectionMethod };

/**
 * 接続し直しのダイアログ。
 * @param props - account：接続し直すAccount、onClose：閉じる、onTokenSuccess：トークンで接続し直した後（権限の案内に使う）
 * @returns ダイアログ
 */
export function ReconnectDialog({
  account,
  onClose,
  onTokenSuccess,
}: {
  account: ReconnectTarget;
  onClose: () => void;
  onTokenSuccess?: (result: TokenConnectResponse) => void;
}) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<"choose" | "token">("choose");
  const method = account.connectionMethod ?? "app";
  const oauth = useMutation({
    mutationFn: () => api.connect({ mode: "reconnect", accountId: account.id }),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });

  const options = [
    { key: "app" as const, label: "Threadsで許可する", note: "このアプリのMetaアプリで許可します" },
    { key: "token" as const, label: "トークンを貼り付ける", note: "自分のMetaアプリで作ったトークンを使います" },
  ];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent mobileFullScreen showClose={false} className="gap-0 p-0 sm:max-w-lg" aria-describedby="reconnect-desc">
        <div className="flex h-[52px] shrink-0 items-center gap-1 border-b px-1.5 md:h-auto md:border-0 md:px-6 md:pt-5 md:pb-2">
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-lg hover:bg-accent md:order-last md:-mr-2 md:size-9"
          >
            <XIcon className="size-5" />
          </button>
          <DialogTitle className="flex-1 truncate text-base font-semibold md:text-[17px]">Threadsとの接続し直し</DialogTitle>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:max-h-[75vh] md:px-6 md:pb-6">
          <DialogDescription id="reconnect-desc" className="text-sm text-foreground/80">
            @{account.username}の接続を更新します。投稿ストックや設定はそのまま残ります。
          </DialogDescription>
          {choice === "choose" ? (
            <div className="space-y-2">
              {options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={oauth.isPending}
                  onClick={() => (o.key === "app" ? oauth.mutate() : setChoice("token"))}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left hover:bg-accent",
                    method === o.key && "border-foreground",
                  )}
                >
                  <span className="space-y-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {o.label}
                      {method === o.key && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">今の接続</span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">{o.note}</span>
                  </span>
                  <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
                </button>
              ))}
              {oauth.isError && (
                <Alert variant="destructive">
                  <AlertDescription className="text-foreground">{describeError(oauth.error)}</AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <TokenConnectForm
              mode="reconnect"
              accountId={account.id}
              username={account.username}
              onSuccess={(result) => {
                toast.success("接続し直しました");
                void queryClient.invalidateQueries({ queryKey: ["me"] });
                void queryClient.invalidateQueries({ queryKey: ["account", account.id] });
                onTokenSuccess?.(result);
                onClose();
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

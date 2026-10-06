import { useMutation } from "@tanstack/react-query";
import { api, describeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/**
 * 現在のAccountのThreads接続を更新する。
 * @param props - accountId：再接続するAccount
 * @returns 再接続ボタンと、失敗の案内
 */
export function ReconnectButton({ accountId }: { accountId: string }) {
  const connect = useMutation({
    mutationFn: () => api.connect({ mode: "reconnect", accountId }),
    onSuccess: (result) => window.location.assign(result.authorizeUrl),
  });
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={connect.isPending}
        onClick={() => connect.mutate()}
      >
        再接続
      </Button>
      {connect.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {describeError(connect.error)}
        </p>
      )}
    </div>
  );
}

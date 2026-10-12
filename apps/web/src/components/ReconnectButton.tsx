// 「再接続」のボタン（001 FR-019。specs/010 で接続の方法を選ぶダイアログを開く形にした）
import { useState } from "react";
import { useOutletContext } from "react-router";
import type { AccountSummary } from "@threads-grower/shared";
import { ReconnectDialog } from "@/components/connect/ReconnectDialog";
import { Button } from "@/components/ui/button";

/**
 * 現在のAccountのThreads接続を更新する。押すと、このアプリで許可かトークンの貼り付けを選ぶダイアログを開く。
 * @param props - accountId：再接続するAccount
 * @returns 再接続ボタン
 */
export function ReconnectButton({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  // Accountの画面の中ではユーザー名と今の方法が分かる（外で使うときは分からないまま開く）
  const account = useOutletContext<{ account?: AccountSummary } | undefined>()?.account;
  // 接続し直しはオーナーだけ（specs/008 FR-044、specs/010 FR-034）。呼び出し側で隠していなくても、
  // パートナー・編集者にはトークンの入力欄を出さない（PR #12 のCodexレビュー）
  if (account?.id === accountId && account.role !== "owner") return null;
  return (
    <div>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        再接続
      </Button>
      {open && (
        <ReconnectDialog
          account={{
            id: accountId,
            username: account?.id === accountId ? account.username : "",
            connectionMethod: account?.id === accountId ? account.connectionMethod : undefined,
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

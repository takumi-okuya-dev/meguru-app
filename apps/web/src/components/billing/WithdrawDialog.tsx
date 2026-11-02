// 退会のダイアログ（specs/013 contracts/ui-routes.md「退会」、FR-050）。
// 消えるもの・チームの行き先・契約の扱いを出し、メールアドレスの入力で確定する。終わったらログアウトして入口へ移る。
import { useClerk } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, type WithdrawalPreview } from "@threads-grower/shared";
import { useState } from "react";
import { useNavigate } from "react-router";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, api, setWithdrawalInProgress } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

const normalize = (v: string) => v.trim().toLowerCase();

/**
 * チームの行き先の文。
 * @param t - チーム
 * @returns 文
 */
function teamLine(t: WithdrawalPreview["teams"][number]): string {
  if (t.outcome === "transfer") return `${t.name}：${t.nextAdminName ?? "ほかの人"}さんに管理者を引き継ぎます`;
  if (t.outcome === "delete") return `${t.name}：チームを削除します`;
  return `${t.name}：チームから外れます`;
}

/**
 * 退会のダイアログ。
 * @param props - open：開いているか、onOpenChange：開閉
 * @returns ダイアログ
 */
export function WithdrawDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const preview = useQuery({ queryKey: queryKeys.withdrawalPreview, queryFn: api.withdrawalPreview, enabled: open, staleTime: 0 });
  const withdraw = useMutation({
    mutationFn: () => api.withdraw(email),
    onSuccess: async () => {
      setWithdrawalInProgress(false);
      await signOut();
      queryClient.clear();
      void navigate("/sign-in?withdrawn=1", { replace: true });
    },
  });
  const code = withdraw.error instanceof ApiError ? withdraw.error.code : withdraw.error ? "INTERNAL_ERROR" : null;
  const matches = Boolean(preview.data) && normalize(email) !== "" && normalize(email) === normalize(preview.data!.email);
  const p = preview.data;

  return (
    <Dialog open={open} onOpenChange={(v) => !withdraw.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>退会しますか？</DialogTitle>
          <DialogDescription>退会すると、元に戻せません。</DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <p className="text-sm text-muted-foreground">読み込んでいます…</p>
        ) : preview.isError || !p ? (
          <p role="alert" className="text-sm text-destructive">
            退会の内容を読み込めませんでした。閉じて、もう一度お試しください。
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <section className="space-y-1">
              <h3 className="font-medium">消えるもの</h3>
              {p.ownedAccounts.length > 0 ? (
                <>
                  <p>
                    あなたのアカウント（{p.ownedAccounts.length}件）：{p.ownedAccounts.map((a) => a.name).join("、")}
                  </p>
                  <p className="text-muted-foreground">戦略・投稿ストック・設定・パフォーマンス・Threadsとのつながり・予約中の自動投稿</p>
                </>
              ) : (
                <p>あなたのアカウントはありません</p>
              )}
            </section>
            {p.teams.length > 0 && (
              <section className="space-y-1">
                <h3 className="font-medium">チーム</h3>
                <ul className="list-disc pl-5">
                  {p.teams.map((t) => (
                    <li key={t.id}>{teamLine(t)}</li>
                  ))}
                </ul>
              </section>
            )}
            {p.hasActiveSubscription && <p>契約はすぐに止まり、残りの期間の返金はありません。</p>}
            <div className="space-y-1.5">
              <label htmlFor="withdraw-email" className="block">
                確認のため、メールアドレス（{p.email}）を入れてください
              </label>
              <Input
                id="withdraw-email"
                type="email"
                autoComplete="off"
                value={email}
                disabled={withdraw.isPending}
                onChange={(e) => setEmail(e.target.value)}
              />
              {code === "CONFIRMATION_MISMATCH" && <p className="text-destructive">メールアドレスが違います</p>}
            </div>
            {code && code !== "CONFIRMATION_MISMATCH" && (
              <p role="alert" className="text-destructive">
                {errorMessage(code).message}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="rounded-full" disabled={withdraw.isPending} onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            variant="destructive"
            className="rounded-full"
            disabled={!matches || withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            <SwapLabel current={withdraw.isPending ? "退会しています…" : "退会する"} labels={["退会する", "退会しています…"]} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

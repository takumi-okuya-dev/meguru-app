// 担当になったアカウントのホームに1回だけ出す「（アカウント名）の担当になりました」（specs/011-team-revision FR-062、research.md R9）。
import type { AccountSummary } from "@meguru/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UsersIcon, XIcon } from "lucide-react";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";
import { useAccountAccess } from "@/apps/threads/lib/use-account-access";

/**
 * 担当の知らせ。閉じると出なくなる。担当の人で、閉じていないときだけ出す（オーナーには出さない）。
 * @param props - account：表示中のAccount
 * @returns 知らせ。出さないときは何も出さない
 */
export function AssignedNotice({ account }: { account: AccountSummary }) {
  const queryClient = useQueryClient();
  // サイドバーと同じ問い合わせを使う（個人運用の問い合わせの数を増やさない。SC-005）
  const { access } = useAccountAccess(account.id);
  const dismiss = useMutation({
    mutationFn: () => threadsApi.dismissAssignedNotice(account.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.access(account.id) }),
  });
  if (!access?.assignedNotice || dismiss.isSuccess) return null;
  return (
    <div role="status" className="flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm">
      <UsersIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex-1">{account.name}の担当になりました。投稿の案を作れます。</span>
      <button
        type="button"
        aria-label="閉じる"
        className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
        onClick={() => dismiss.mutate()}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

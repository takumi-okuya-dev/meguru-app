// 招待済みで、申し込んだユーザー名と違うアカウントでつながったときの知らせ（specs/025-threads-account-guide contracts/ui-routes.md 3、
// US3・FR-007・FR-008、モック4枚目）。オーナーが閉じるまで出し、閉じたらその接続については出さない。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";

/**
 * 違うアカウントでつながった知らせ。出すものがなければ何も出さない（読めないときも出さない）。
 * 接続し直しは同じThreadsアカウントでしかできない（specs/010 FR-032）ので、申し込んだアカウントを使う道は
 * 新しいアカウントを作って申し込み直すことだけを案内する（PR #72 のCodexレビュー）。
 * @param props - accountId：アカウント
 * @returns 知らせ
 */
export function ConnectionNotice({ accountId }: { accountId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: threadsQueryKeys.connectionNotice(accountId), queryFn: () => threadsApi.connectionNotice(accountId) });
  const dismiss = useMutation({
    mutationFn: () => threadsApi.dismissConnectionNotice(accountId),
    onSuccess: () => client.setQueryData(threadsQueryKeys.connectionNotice(accountId), { otherAccount: null }),
  });
  const other = q.data?.otherAccount;
  if (!other) return null;
  return (
    <Alert role="status">
      <AlertDescription className="flex gap-2.5 text-foreground">
        <CircleAlertIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1.5">
          <p className="text-sm leading-relaxed">
            <strong className="font-semibold">@{other.connectedUsername}</strong> でつながりました。申し込んだ{" "}
            <strong className="font-semibold">@{other.appliedUsername}</strong> とは違うアカウントです。
          </p>
          <ul className="space-y-0.5 text-[13px] text-muted-foreground">
            <li>・このままでよければ、閉じてください</li>
            <li>・このアカウントのThreadsは、@{other.connectedUsername} から変えられません</li>
            <li>
              ・@{other.appliedUsername} を使うときは、「アカウントを作る」で新しいアカウントを作り、@{other.appliedUsername} で招待を申し込み直す
            </li>
          </ul>
          {dismiss.isError && <p className="text-[13px] text-destructive">{describeError(dismiss.error)}</p>}
          <Button variant="ghost" className="-ml-4 h-10 rounded-full md:h-9" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
            閉じる
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

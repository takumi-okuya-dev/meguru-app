// オーナーのホームに1回だけ出す「パートナーとして参加しました」（specs/008-team-operations FR-047(1)）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersIcon, XIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * パートナーが参加した知らせ。閉じると出なくなる。オーナーで、閉じていないときだけ出す。
 * @param props - accountId：Account
 * @returns 知らせ。出さないときは何も出さない
 */
export function PartnerJoinedNotice({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: queryKeys.accountTeam(accountId), queryFn: () => api.accountTeam(accountId) });
  const dismiss = useMutation({
    mutationFn: () => api.dismissPartnerJoined(accountId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.accountTeam(accountId) }),
  });
  const partner = team.data?.partner;
  if (!partner || !team.data?.joinedNotice.show || dismiss.isSuccess) return null;
  const who = partner.teamName ? `${partner.name}さん（${partner.teamName}）` : `${partner.name}さん`;
  return (
    <div role="status" className="flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm">
      <UsersIcon className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex-1">{who}がパートナーとして参加しました</span>
      <Button asChild variant="outline" size="sm" className="rounded-full">
        <Link to={`/accounts/${accountId}/settings`}>設定を開く</Link>
      </Button>
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

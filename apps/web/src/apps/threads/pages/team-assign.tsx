// 担当を決める（/teams/:teamId/assign。specs/011-team-revision contracts/ui-routes.md「担当を決める」、US2、FR-022〜FR-024）。
// 行＝編集者と管理者（自分）、列＝チームのアカウント。自分のアカウントのセルは「自分」。管理者だけが開ける。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, type TeamAssignments } from "@meguru/shared";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { PageBody, PageHeader } from "@/shell";
import { Button } from "@/components/ui/button";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { NotFound } from "@/shell";

/**
 * 担当の表の画面。
 * @returns 画面
 */
export function TeamAssignPage() {
  const { teamId = "" } = useParams<{ teamId: string }>();
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: queryKeys.team(teamId), queryFn: () => api.getTeam(teamId) });
  const table = useQuery({
    queryKey: queryKeys.teamAssignments(teamId),
    queryFn: () => api.getAssignments(teamId),
    enabled: team.data?.myRole === "admin",
  });
  const toggle = useMutation({
    mutationFn: ({ userId, accountId, on }: { userId: string; accountId: string; on: boolean }) =>
      on ? api.assign(teamId, userId, accountId) : api.unassign(teamId, userId, accountId),
    // 押すとすぐ切り替え、失敗したら元に戻す
    onMutate: ({ userId, accountId, on }) => {
      const prev = queryClient.getQueryData<TeamAssignments>(queryKeys.teamAssignments(teamId));
      if (prev) {
        queryClient.setQueryData<TeamAssignments>(queryKeys.teamAssignments(teamId), {
          ...prev,
          people: prev.people.map((p) =>
            p.userId !== userId
              ? p
              : { ...p, accountIds: on ? [...p.accountIds, accountId] : p.accountIds.filter((id) => id !== accountId) },
          ),
        });
      }
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.teamAssignments(teamId), ctx.prev);
      toast.error(describeError(err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teamAssignments(teamId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) });
    },
  });

  if (team.isPending) return <LoadingSkeleton />;
  if (team.isError) {
    if (team.error instanceof ApiError && team.error.code === "TEAM_NOT_FOUND") {
      return <NotFound message={errorMessage("TEAM_NOT_FOUND").message} />;
    }
    return <ApiErrorScreen error={team.error} onRetry={() => void team.refetch()} />;
  }
  const back = (
    <Button asChild variant="ghost" size="icon" className="size-10 md:size-9" aria-label="チームの画面に戻る">
      <Link to={`/teams/${teamId}`}>
        <ArrowLeftIcon className="size-5" />
      </Link>
    </Button>
  );
  if (team.data.myRole !== "admin") {
    return (
      <>
        <PageHeader title="担当を決める" actions={back} />
        <PageBody>
          <p className="text-sm text-muted-foreground">担当を決められるのは、チームの管理者だけです。</p>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader title="担当を決める" actions={back} />
      <PageBody className="max-w-5xl space-y-3">
        <div className="text-sm text-muted-foreground">{team.data.name}</div>
        <p className="text-sm text-foreground/80">
          チェックしたアカウントで、その人が投稿の案を作る・直すことができます。承認と設定は、そのアカウントのオーナーだけです。ロールが「メンバー」の人は、ここに出ません。
        </p>
        {table.isPending ? (
          <LoadingSkeleton />
        ) : table.isError ? (
          <ApiErrorScreen error={table.error} onRetry={() => void table.refetch()} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-56 px-4 py-2.5 text-left font-normal">
                    担当の人
                  </th>
                  {table.data.accounts.map((a) => (
                    <th key={a.id} scope="col" className="px-2 py-2.5 text-center font-normal leading-tight">
                      <span className="block text-foreground">{a.name}</span>
                      {/* 名前は重なりうるので、@ユーザー名で見分ける（PR #15 のCodexレビュー） */}
                      {a.username && <span className="block text-[11px]">@{a.username}</span>}
                      <span className="text-[11px]">{a.ownerName}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.data.people.map((p) => (
                  <tr key={p.userId} className="border-t">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <span className="flex flex-col leading-tight">
                        <span className="font-medium">{p.isMe ? `${p.name}（あなた）` : p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.role === "admin" ? "管理者" : "編集者"}
                          {p.role === "editor" && p.accountIds.length === 0 ? " · 担当を決めてください" : ""}
                        </span>
                      </span>
                    </th>
                    {table.data.accounts.map((a) => {
                      const self = a.ownerUserId === p.userId;
                      const on = p.accountIds.includes(a.id);
                      return (
                        <td key={a.id} className="px-2 py-1 text-center">
                          {self ? (
                            <span className="text-xs text-muted-foreground">自分</span>
                          ) : (
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              aria-label={`${p.name}を${a.username ? `${a.name}（@${a.username}）` : a.name}の担当にする`}
                              onClick={() => toggle.mutate({ userId: p.userId, accountId: a.id, on: !on })}
                              className="inline-flex size-11 items-center justify-center"
                            >
                              <span
                                className={cn(
                                  "flex size-[22px] items-center justify-center rounded-md border-[1.5px] border-muted-foreground",
                                  on && "border-0 bg-foreground text-background",
                                )}
                              >
                                {on && <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={3} />}
                              </span>
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          担当にしたアカウントは、オーナーが「チームに見せる」をオフにしていても、その人は開けます。
        </p>
      </PageBody>
    </>
  );
}

// このアカウントの設定の「チーム」の区分（specs/011-team-revision contracts/ui-routes.md「このアカウントの設定：チームの区分」、US1・US3）。
// 個人運用（チームに入っていない）のオーナーに出すのは「チームに入っていません」と「チームを作る」の1行だけ
// （Constitution 4.0.1 原則Vの例外の1区分）。このときは、チームの問い合わせもしない。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountAccessResponse, AccountTeam } from "@meguru/shared";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { SettingCard, SettingRow } from "@/components/SettingRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";
import { cn } from "@/lib/utils";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { RoleDiagram } from "./RoleDiagram";
import { TeamMark } from "./TeamMark";
import { TeamRoster } from "./TeamRoster";
import { accountPath, teamPath } from "@/apps/threads/lib/paths";

/**
 * ロールの図を開く・閉じる行（FR-056）。見ている人のロールに「あなた」の印を付ける。
 * @param props - you：見ている人のチームでのロール
 * @returns 行と図
 */
function RolesHelp({ you }: { you?: "admin" | "member" | "editor" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm text-foreground underline underline-offset-4"
      >
        ロールと、できることを見る
        <ChevronDownIcon aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <RoleDiagram you={you} />}
    </div>
  );
}

/**
 * チームに入っているときの中身（チーム名・チームに見せる・このアカウントの担当）。
 * @param props - accountId：Account、access：関わりと権限
 * @returns 中身
 */
function InTeam({ accountId, access }: { accountId: string; access: AccountAccessResponse }) {
  const queryClient = useQueryClient();
  const isOwner = access.relation === "owner";
  const team = useQuery({ queryKey: threadsQueryKeys.accountTeam(accountId), queryFn: () => threadsApi.accountTeam(accountId) });
  const share = useMutation({
    mutationFn: (shared: boolean) => threadsApi.setTeamShared(access.team!.id, accountId, shared),
    // 押すとすぐ切り替え、失敗したら元に戻す
    onMutate: (shared) => {
      const prev = queryClient.getQueryData<AccountTeam>(threadsQueryKeys.accountTeam(accountId));
      if (prev?.team) queryClient.setQueryData<AccountTeam>(threadsQueryKeys.accountTeam(accountId), { ...prev, team: { ...prev.team, shared } });
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(threadsQueryKeys.accountTeam(accountId), ctx.prev);
      toast.error(describeError(err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.accountTeam(accountId) });
      void queryClient.invalidateQueries({ queryKey: ["team", access.team!.id] });
    },
  });
  if (team.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        読み込めませんでした。{" "}
        <button type="button" className="text-ring underline" onClick={() => void team.refetch()}>
          再読み込み
        </button>
      </p>
    );
  }
  const data = team.data;
  if (!data?.team) return null;
  return (
    <div className="space-y-5">
      <SettingCard>
        <Link to={teamPath(data.team.id)} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-accent">
          <TeamMark name={data.team.name} className="size-8 text-sm" />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-medium">{data.team.name}</span>
            <span className="text-xs text-muted-foreground">管理者：{data.team.admin.name}</span>
          </span>
          <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        </Link>
        {isOwner && (
          <SettingRow
            label="チームに見せる"
            description={data.team.shared ? "チームの人が、投稿ストックと戦略を読めます" : "チームの人には、名前だけが出ます"}
          >
            <Switch aria-label="このアカウントをチームに見せる" checked={data.team.shared} onCheckedChange={(v) => share.mutate(v)} />
          </SettingRow>
        )}
      </SettingCard>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground/80">このアカウントの担当</h3>
        <TeamRoster team={data} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">担当は、チームの管理者が決めます。承認と設定は、オーナーだけが行います。</p>
          {access.permissions.includes("activity") && (
            <Link className="text-sm text-foreground underline" to={accountPath(accountId, "activity")}>
              操作の記録を見る
            </Link>
          )}
        </div>
      </div>
      <RolesHelp you={access.team?.myRole} />
    </div>
  );
}

/**
 * 「チーム」の区分。チームに入っていなければ1行（オーナーだけ）、入っていればチーム名・見せる設定・担当を出す。
 * @param props - accountId：Account、access：関わりと権限
 * @returns 区分。出すものがなければ何も出さない
 */
export function TeamSection({ accountId, access }: { accountId: string; access: AccountAccessResponse }) {
  const [creating, setCreating] = useState(false);
  if (!access.team && access.relation !== "owner") return null;
  return (
    <section aria-labelledby="team-heading" className="space-y-3">
      <h2 id="team-heading" className="font-medium">
        チーム
      </h2>
      {access.team ? (
        <InTeam accountId={accountId} access={access} />
      ) : (
        <SettingCard>
          <SettingRow label="チームに入っていません">
            <Button variant="outline" className="h-10 rounded-full md:h-9" onClick={() => setCreating(true)}>
              チームを作る
            </Button>
          </SettingRow>
        </SettingCard>
      )}
      {creating && <CreateTeamDialog initialAccountId={accountId} onClose={() => setCreating(false)} />}
    </section>
  );
}

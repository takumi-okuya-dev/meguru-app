// チームの画面（/teams/:teamId。specs/011-team-revision contracts/ui-routes.md「チームの画面」、US1・US2・US3・US5）。
// 見ている人のロールで出し分ける：管理者はロールの切り替え・招待・担当・外す・引き継ぐ・名前・削除、
// メンバー・編集者は自分のアカウントの「チームに見せる」と抜ける。出し分けは見た目のためだけで、守りはAPIの判定にある。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TEAM_NAME_MAX, countChars, errorMessage, type TeamDetail, type TeamMember } from "@threads-grower/shared";
import { ChevronRightIcon, EllipsisIcon, PlusIcon, UsersIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { AccountAvatar } from "@/components/AccountAvatar";
import { LoadingSkeleton } from "@/components/guards";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { ConfirmDialog } from "@/components/team/ConfirmDialog";
import { InviteLinkDialog } from "@/components/team/InviteLinkDialog";
import { LeaveTeamDialog } from "@/components/team/LeaveTeamDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { NotFound } from "@/pages/not-found";

const ROLE_NAMES = { admin: "管理者", member: "メンバー", editor: "編集者" } as const;

/** 開いている確認のダイアログ。 */
type Pending =
  | { kind: "leave" }
  | { kind: "remove"; member: TeamMember }
  | { kind: "transfer"; member: TeamMember }
  | { kind: "rename" }
  | { kind: "delete" }
  | { kind: "add-account" }
  | null;

/**
 * アカウントのチップ。開けるものは「見る」、開けないものは点線の「見せていません」。
 * @param props - teamId：チーム、account：アカウント、owner：オーナーの名前
 * @returns チップ
 */
function AccountChip({ teamId, account, owner }: { teamId: string; account: TeamMember["accounts"][number]; owner: string }) {
  const label = account.name;
  if (!account.canOpen) {
    return (
      <span className="inline-flex h-9 items-center rounded-full border border-dashed border-muted-foreground/50 px-3.5 text-[13px] text-muted-foreground">
        {label} · 見せていません
      </span>
    );
  }
  if (account.relation === "owner") {
    return (
      <Link
        to={`/accounts/${account.id}`}
        className="inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] hover:bg-accent"
      >
        {label} · あなた
      </Link>
    );
  }
  const to = account.relation === "assigned" ? `/accounts/${account.id}` : `/teams/${teamId}/accounts/${account.id}`;
  return (
    <Link
      to={to}
      aria-label={`${owner}さんの${label}を見る`}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-foreground px-3.5 text-[13px] hover:bg-accent"
    >
      {label}
      <span className="text-xs">{account.relation === "assigned" ? "担当" : "見る"}</span>
      <ChevronRightIcon aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

/**
 * 管理者の、メンバー⇔編集者の切り替え（2つのボタンの群）。
 * @param props - member：切り替える人、disabled：処理中、onChange：切り替える
 * @returns ボタンの群
 */
function RoleToggle({
  member,
  disabled,
  onChange,
}: {
  member: TeamMember;
  disabled: boolean;
  onChange: (role: "member" | "editor") => void;
}) {
  return (
    <span role="group" aria-label={`${member.name}さんのロール`} className="inline-flex rounded-full bg-muted p-0.5">
      {(["member", "editor"] as const).map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={member.role === r}
          disabled={disabled}
          onClick={() => member.role !== r && onChange(r)}
          className={cn(
            "h-9 rounded-full px-3.5 text-[13px] text-muted-foreground",
            member.role === r && "bg-background font-medium text-foreground shadow-sm",
          )}
        >
          {ROLE_NAMES[r]}
        </button>
      ))}
    </span>
  );
}

/**
 * チーム名を直すダイアログ（1〜50文字。FR-017）。
 * @param props - current：今の名前、pending：保存中、error：失敗の文言、onSave：保存する、onCancel：やめる
 * @returns ダイアログ
 */
function RenameDialog({
  current,
  pending,
  error,
  onSave,
  onCancel,
}: {
  current: string;
  pending: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current);
  const length = countChars(name.trim());
  const ok = length >= 1 && length <= TEAM_NAME_MAX;
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md" aria-describedby="rename-desc">
        <DialogTitle>チーム名を直す</DialogTitle>
        <DialogDescription id="rename-desc">チームの人のサイドバーと、招待の画面に出ます。</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onSave(name);
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="rename-team" className="text-sm font-medium">
              チーム名
            </label>
            <input
              id="rename-team"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 w-full rounded-xl border bg-background px-3 text-base md:text-sm"
            />
            <p className={cn("text-xs text-muted-foreground", length > TEAM_NAME_MAX && "text-destructive")}>
              1〜{TEAM_NAME_MAX}文字（{length}/{TEAM_NAME_MAX}）
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-10 rounded-full" onClick={onCancel}>
              キャンセル
            </Button>
            <Button type="submit" className="h-10 rounded-full" disabled={!ok || pending}>
              保存
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * チームの画面。
 * @returns 画面
 */
export function TeamPage() {
  const { teamId = "" } = useParams<{ teamId: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const team = useQuery({ queryKey: queryKeys.team(teamId), queryFn: () => api.getTeam(teamId) });
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const isAdmin = team.data?.myRole === "admin";
  const [inviteOpen, setInviteOpen] = useState(false);
  const invite = useQuery({
    queryKey: queryKeys.teamInvite(teamId),
    queryFn: () => api.getTeamInvite(teamId),
    enabled: inviteOpen && isAdmin,
  });
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    ]);
  const close = () => {
    setPending(null);
    setError(null);
  };
  /** チームの操作。成功したら一覧を読み直し、ダイアログを閉じる。失敗したら文言を出す */
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      close();
      await refresh();
    },
    onError: (err) => {
      setError(describeError(err));
      void refresh();
    },
  });
  /** ダイアログを使わない操作（ロール・見せる設定）。失敗はトーストで出す */
  const quick = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSettled: () => void refresh(),
    onError: (err) => toast.error(describeError(err)),
  });
  const rotate = useMutation({
    mutationFn: () => api.rotateTeamInvite(teamId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.teamInvite(teamId), data);
      toast.success("新しいリンクを作りました。前のリンクは使えません。");
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const leave = useMutation({
    mutationFn: (newAdminUserId?: string) => api.leaveTeam(teamId, newAdminUserId),
    onSuccess: async () => {
      close();
      queryClient.removeQueries({ queryKey: queryKeys.team(teamId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success("チームを抜けました");
      void navigate("/", { replace: true });
    },
    onError: (err) => setError(describeError(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteTeam(teamId),
    onSuccess: async () => {
      close();
      queryClient.removeQueries({ queryKey: queryKeys.team(teamId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success("チームを削除しました");
      void navigate("/", { replace: true });
    },
    onError: (err) => setError(describeError(err)),
  });

  if (team.isPending) return <LoadingSkeleton />;
  if (team.isError) {
    if (team.error instanceof ApiError && team.error.code === "TEAM_NOT_FOUND") {
      return <NotFound message={errorMessage("TEAM_NOT_FOUND").message} />;
    }
    return <ApiErrorScreen error={team.error} onRetry={() => void team.refetch()} />;
  }
  const t: TeamDetail = team.data;
  const mine = t.members.find((m) => m.isMe);
  const myAccounts = mine?.accounts ?? [];
  const notices = t.members.filter((m) => m.joinedNotice);
  const addable = (me.data?.accounts ?? []).filter((a) => a.role === "owner" && !myAccounts.some((x) => x.id === a.id));

  return (
    <>
      <PageHeader
        title={t.name}
        actions={
          isAdmin ? (
            <Button className="h-10 rounded-full px-3 md:h-9 md:px-4" onClick={() => setInviteOpen(true)}>
              <PlusIcon className="size-4" />
              {/* スマートフォンの上部バーは狭いので、文字は読み上げだけにする */}
              <span className="max-sm:sr-only">メンバーを招待</span>
            </Button>
          ) : undefined
        }
      />
      <PageBody className="max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-muted-foreground">
            メンバー {t.members.length}人 · 管理者：{t.admin.name}
            {!isAdmin && mine ? ` · あなたのロール：${ROLE_NAMES[mine.role]}` : ""}
          </span>
          <span className="flex flex-1 flex-wrap justify-end gap-2">
            <Button variant="ghost" className="h-10 rounded-full md:h-9" onClick={() => setPending({ kind: "leave" })}>
              チームを抜ける
            </Button>
            {isAdmin && (
              <>
                <Button asChild variant="outline" className="h-10 rounded-full md:h-9">
                  <Link to={`/teams/${teamId}/assign`}>担当を決める</Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-10 md:size-9" aria-label="チームの操作">
                      <EllipsisIcon className="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="rounded-xl p-1.5">
                    <DropdownMenuItem className="min-h-11 rounded-lg" onSelect={() => setPending({ kind: "rename" })}>
                      チーム名を直す
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11 rounded-lg text-destructive" onSelect={() => setPending({ kind: "delete" })}>
                      チームを削除する
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </span>
        </div>

        {notices.map((m) => (
          <div key={m.userId} role="status" className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm">
            <UsersIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1">{m.name}さんが参加しました</span>
            <button
              type="button"
              aria-label={`${m.name}さんの参加の知らせを閉じる`}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              onClick={() => quick.mutate(() => api.dismissJoinedNotice(teamId, m.userId))}
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ))}

        <section aria-labelledby="mine-heading" className="space-y-2.5">
          <h2 id="mine-heading" className="font-medium">
            チームに入れている、あなたのアカウント
          </h2>
          <ul className="divide-y overflow-hidden rounded-2xl border">
            {myAccounts.map((a) => {
              const label = a.name;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <AccountAvatar account={a} className="size-9" />
                  <span className="flex min-w-0 flex-1 flex-col leading-snug">
                    <span className="truncate font-medium">{label}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {a.shared ? "チームの人が、投稿ストックと戦略を読めます" : "チームの人には、名前だけが出ます"}
                    </span>
                  </span>
                  <label className="flex items-center gap-2 text-[13px]">
                    チームに見せる
                    <Switch
                      aria-label={`${label}をチームに見せる`}
                      checked={a.shared}
                      disabled={quick.isPending}
                      onCheckedChange={(v) => quick.mutate(() => api.setTeamShared(teamId, a.id, v))}
                    />
                  </label>
                  {myAccounts.length > 1 && (
                    <Button
                      variant="ghost"
                      className="h-10 rounded-full text-muted-foreground md:h-9"
                      disabled={quick.isPending}
                      onClick={() => quick.mutate(() => api.removeTeamAccount(teamId, a.id))}
                    >
                      チームから外す
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {addable.length > 0 && (
            <Button variant="outline" className="h-10 rounded-full md:h-9" onClick={() => setPending({ kind: "add-account" })}>
              <PlusIcon className="size-4" />
              アカウントを足す
            </Button>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <section aria-labelledby="members-heading" className="min-w-0 space-y-2.5">
            <h2 id="members-heading" className="font-medium">
              メンバー
            </h2>
            {isAdmin && (
              <p className="text-sm text-muted-foreground">
                全員が自分のThreadsアカウントを持っています。自分のアカウントでは、誰でもそのアカウントのオーナー（承認・設定・支払い）です。下のロールは、ほかの人のアカウントに何ができるかを決めます。
              </p>
            )}
            <ul aria-label="メンバーの一覧" className="divide-y overflow-hidden rounded-2xl border">
              {t.members.map((m) => (
                <li key={m.userId} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
                  <span className="flex min-w-0 items-center gap-2.5 md:w-52 md:shrink-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold">
                      {[...m.name][0]}
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{m.name}</span>
                        {m.isMe && (
                          <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
                            あなた
                          </span>
                        )}
                      </span>
                      {!(isAdmin && m.role !== "admin") && (
                        <span className="text-xs text-muted-foreground">
                          {m.role === "admin" && m.isMe ? "管理者（あなた）" : ROLE_NAMES[m.role]}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-2">
                    {m.accounts.map((a) => (
                      <AccountChip key={a.id} teamId={teamId} account={a} owner={m.name} />
                    ))}
                  </span>
                  {isAdmin && m.role !== "admin" && (
                    <span className="flex items-center gap-1">
                      <RoleToggle
                        member={m}
                        disabled={quick.isPending}
                        onChange={(role) => quick.mutate(() => api.setMemberRole(teamId, m.userId, role))}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-10 md:size-9" aria-label={`${m.name}さんの操作`}>
                            <EllipsisIcon className="size-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl p-1.5">
                          <DropdownMenuItem className="min-h-11 rounded-lg" onSelect={() => setPending({ kind: "transfer", member: m })}>
                            管理者を引き継ぐ
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-11 rounded-lg text-destructive"
                            onSelect={() => setPending({ kind: "remove", member: m })}
                          >
                            チームから外す
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              ほかの人が見せているアカウントは、投稿ストックと戦略を読めます（直すことはできません）。見せていないアカウントは、名前だけが出ます。
            </p>
          </section>
          {isAdmin && (
            <aside aria-label="ロールの説明" className="space-y-2.5 text-sm">
              <div className="space-y-1 rounded-2xl border p-4">
                <div className="font-medium">メンバー</div>
                <p className="text-[13px] text-foreground/80">
                  ほかの人が「チームに見せる」にしたアカウントの、投稿ストックと戦略を見られる（読むだけ）。招待リンクから入った人は、まずメンバーになります。
                </p>
              </div>
              <div className="space-y-1 rounded-2xl border p-4">
                <div className="font-medium">編集者</div>
                <p className="text-[13px] text-foreground/80">
                  メンバーと同じく見られるうえに、担当になったアカウントで投稿の案を作る・直す。承認と設定は、そのアカウントのオーナーだけ。
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                ロールは、管理者がいつでも切り替えられます。切り替えても、その人のアカウントの持ち主は変わりません。
              </p>
            </aside>
          )}
        </div>
      </PageBody>

      {inviteOpen && (
        <InviteLinkDialog
          title={`${t.name}にメンバーを招待`}
          description="このリンクを、お店・お客さまやスタッフに送ってください。入った人は、まずメンバーになります。編集者にするときは、メンバーの一覧でロールを切り替えてください。"
          url={invite.data?.url ?? null}
          loadFailed={invite.isError}
          onRetry={() => void invite.refetch()}
          qrNote="会って招くときは、相手のスマホでこのQRコードを読み取ってもらいます。"
          onRotate={() => rotate.mutate()}
          rotating={rotate.isPending}
          onClose={() => setInviteOpen(false)}
        >
          <p className="text-xs text-muted-foreground">
            入るときに、自分のThreadsアカウントを1つ以上チームに入れてもらいます。リンクはチームに1本です。リンクに期限はありません。広まってしまったときは作り直してください。
          </p>
        </InviteLinkDialog>
      )}
      {pending?.kind === "leave" && (
        <LeaveTeamDialog
          team={t}
          pending={leave.isPending}
          error={error}
          onLeave={(newAdminUserId) => leave.mutate(newAdminUserId)}
          onDeleteTeam={() => setPending({ kind: "delete" })}
          onCancel={close}
        />
      )}
      {pending?.kind === "remove" && (
        <ConfirmDialog
          title={`${pending.member.name}さんをチームから外しますか？`}
          confirmLabel="外す"
          destructive
          pending={action.isPending}
          error={error}
          onConfirm={() => action.mutate(() => api.removeMember(teamId, pending.member.userId))}
          onCancel={close}
        >
          <p>その人のアカウントはチームから外れ、担当もなくなります。アカウントは、その人のものとして残ります。</p>
        </ConfirmDialog>
      )}
      {pending?.kind === "transfer" && (
        <ConfirmDialog
          title={`管理者を${pending.member.name}さんに引き継ぎますか？`}
          confirmLabel="引き継ぐ"
          pending={action.isPending}
          error={error}
          onConfirm={() => action.mutate(() => api.transferAdmin(teamId, pending.member.userId))}
          onCancel={close}
        >
          <p>
            引き継いだ後、あなたは担当があれば編集者、なければメンバーになります。ロールの切り替えや招待は、{pending.member.name}
            さんが行います。
          </p>
        </ConfirmDialog>
      )}
      {pending?.kind === "rename" && (
        <RenameDialog
          current={t.name}
          pending={action.isPending}
          error={error}
          onSave={(name) => action.mutate(() => api.renameTeam(teamId, name))}
          onCancel={close}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          title={`${t.name}を削除しますか？`}
          confirmLabel="チームを削除する"
          destructive
          pending={remove.isPending}
          error={error}
          onConfirm={() => remove.mutate()}
          onCancel={close}
        >
          <p>チームの人とアカウントは、すべてチームから外れます。アカウントのデータと操作の記録は残ります。</p>
        </ConfirmDialog>
      )}
      {pending?.kind === "add-account" && (
        <Dialog open onOpenChange={(v) => !v && close()}>
          <DialogContent className="sm:max-w-md" aria-describedby="add-account-desc">
            <DialogTitle>アカウントを足す</DialogTitle>
            <DialogDescription id="add-account-desc">足したアカウントは、初めはチームに見せません。</DialogDescription>
            <ul className="space-y-2">
              {addable.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={action.isPending}
                    onClick={() => action.mutate(() => api.addTeamAccount(teamId, a.id))}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left hover:bg-accent"
                  >
                    <AccountAvatar account={a} className="size-8" />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{a.username ? `@${a.username}` : "未接続"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

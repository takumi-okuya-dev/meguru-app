// 招待の確認（/invite/:token。specs/011-team-revision contracts/ui-routes.md「招待の確認」、US1、FR-012〜FR-016）。
// ログインしていなくても開ける。参加するには、自分のThreadsアカウントを1つ以上選ぶ（なければ先に追加して、このリンクへ戻る）。
// 入った人は、まずメンバーになる。アカウントごとの「チームに見せる」は初めはオフ。
import { useAuth, useClerk } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AccountAvatar } from "@/components/AccountAvatar";
import { CenteredLayout } from "@/components/layout/AppShell";
import { LoadingSkeleton } from "@/components/guards";
import { RoleDiagram } from "@/components/team/RoleDiagram";
import { TeamMark } from "@/components/team/TeamMark";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";

/**
 * 招待の確認画面。
 * @returns 画面
 */
export function InvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preview = useQuery({
    // ログインの状態で「参加できるか」が変わるので、キーに含める
    queryKey: [...queryKeys.invite(token), Boolean(isSignedIn)],
    queryFn: () => api.previewInvite(token),
    enabled: isLoaded,
    retry: false,
  });
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, enabled: Boolean(isSignedIn) });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const here = `/invite/${token}`;
  const signIn = `/sign-in?next=${encodeURIComponent(here)}`;

  const accept = useMutation({
    mutationFn: () =>
      api.acceptInvite(
        token,
        Object.keys(picked)
          .filter((id) => picked[id])
          .map((id) => ({ id, shared: Boolean(shared[id]) })),
      ),
    onSuccess: async ({ teamId }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void navigate(`/teams/${teamId}`, { replace: true });
    },
    onError: () => void preview.refetch(),
  });

  if (!isLoaded || preview.isPending) return <LoadingSkeleton />;

  if (preview.isError) {
    const invalid = preview.error instanceof ApiError && preview.error.code === "INVITE_INVALID";
    return (
      <CenteredLayout>
        <div className="w-full max-w-md space-y-3 rounded-2xl border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">このリンクは使えません</h1>
          <p className="text-sm text-muted-foreground">
            {invalid
              ? "リンクが作り直されたか、チームが削除されました。管理者に、新しいリンクを頼んでください。"
              : describeError(preview.error)}
          </p>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/">アプリを開く</Link>
          </Button>
        </div>
      </CenteredLayout>
    );
  }

  const p = preview.data;
  const status = p.viewer.status;
  const count = p.viewer.accounts.filter((a) => picked[a.id] && !a.inOtherTeam).length;

  return (
    <CenteredLayout>
      <div className="w-full max-w-lg space-y-5">
        <div className="text-center text-base font-semibold">ThreadsGrower</div>
        <section aria-labelledby="join-title" className="space-y-5 rounded-2xl border bg-card p-6">
          <div className="flex items-center gap-3">
            <TeamMark name={p.team.name} className="size-11 rounded-xl text-lg" />
            <div className="min-w-0 leading-snug">
              <h1 id="join-title" className="text-lg font-semibold">
                「{p.team.name}」に招待されています
              </h1>
              <p className="text-[13px] text-muted-foreground">
                管理者：{p.team.adminName} · {p.team.memberCount}人
              </p>
            </div>
          </div>
          <div className="space-y-1 rounded-xl bg-muted/50 p-4 text-sm">
            <div className="font-medium">メンバーとして入ります</div>
            <p className="text-[13px] text-foreground/80">
              ほかの人が「チームに見せる」にしたアカウントの、投稿ストックと戦略を見られます。管理者が、あなたを編集者にすることもあります。あなたのアカウントの承認・設定・支払いは、これまでどおりあなただけが行います。
            </p>
          </div>

          {status === "anonymous" && (
            <Button className="h-12 w-full rounded-full" onClick={() => void navigate(signIn)}>
              Googleで続ける
            </Button>
          )}
          {status !== "anonymous" && me.data && (
            <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-medium">{me.data.user.displayName ?? me.data.user.email} としてログイン中</div>
                <div className="truncate text-xs text-muted-foreground">{me.data.user.email}</div>
              </div>
              <Button
                variant="link"
                className="h-9 px-1 text-sm text-foreground underline"
                onClick={() => {
                  void signOut().then(() => {
                    queryClient.clear();
                    void navigate(signIn, { replace: true });
                  });
                }}
              >
                別のGoogleアカウント
              </Button>
            </div>
          )}

          {status === "needs_account" && (
            <div className="space-y-2.5 rounded-xl border p-4">
              <div className="font-medium">先に、自分のThreadsアカウントをつないでください</div>
              <p className="text-[13px] text-foreground/80">
                チームに入るには、自分のThreadsアカウントが1つ以上要ります。つないだ後、このリンクに戻ってくると続きから参加できます。
              </p>
              <Button asChild className="h-10 rounded-full">
                <Link to={`/accounts/new?next=${encodeURIComponent(here)}`}>Threadsアカウントを追加</Link>
              </Button>
            </div>
          )}

          {status === "ready" && (
            <div className="space-y-4">
              <fieldset className="space-y-2.5">
                <legend className="mb-1 text-sm font-medium">チームに入れる自分のアカウント（1つ以上）</legend>
                {p.viewer.accounts.map((a) => {
                  const on = Boolean(picked[a.id]) && !a.inOtherTeam;
                  const label = a.displayName ?? a.username;
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5",
                        on && "border-foreground",
                        a.inOtherTeam && "opacity-60",
                      )}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="size-5 accent-foreground"
                          checked={on}
                          disabled={Boolean(a.inOtherTeam)}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [a.id]: e.target.checked }))}
                          aria-label={`${label}をチームに入れる`}
                        />
                        <AccountAvatar account={a} className="size-8" />
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate font-medium">{label}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {a.inOtherTeam ? `${a.inOtherTeam}に入っています` : `@${a.username}`}
                          </span>
                        </span>
                      </label>
                      {on && (
                        <label className="flex items-center gap-2 text-[13px] text-foreground/80">
                          チームに見せる
                          <Switch
                            aria-label={`${label}をチームに見せる`}
                            checked={Boolean(shared[a.id])}
                            onCheckedChange={(v) => setShared((prev) => ({ ...prev, [a.id]: v }))}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  「チームに見せる」は、初めはオフです。オンにしたアカウントだけ、チームの人が投稿と戦略を読めます（直すことはできません）。あとから、このアカウントの設定でいつでも変えられます。
                </p>
              </fieldset>
              {accept.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {describeError(accept.error)}
                </p>
              )}
              <div className="space-y-2">
                <Button className="h-12 w-full rounded-full" disabled={count === 0 || accept.isPending} onClick={() => accept.mutate()}>
                  {count === 0 ? "アカウントを選んでください" : `${count}件のアカウントで参加する`}
                </Button>
                <Button asChild variant="ghost" className="h-10 w-full rounded-full">
                  <Link to="/">参加しない</Link>
                </Button>
              </div>
            </div>
          )}

          {status === "already_member" && (
            <div className="space-y-3 text-center">
              <p className="text-sm">すでにこのチームに入っています。</p>
              <Button asChild className="h-11 w-full rounded-full">
                <Link to={p.viewer.teamId ? `/teams/${p.viewer.teamId}` : "/"}>チームを開く</Link>
              </Button>
            </div>
          )}

          {/* 他のアプリにあまりない仕組みなので、ロールの中での自分の位置を図で示す（FR-056）。
              参加のボタンを押し下げないよう、カードの最後に置く */}
          <div className="space-y-2 border-t pt-5">
            <h2 className="text-sm font-medium">チームのしくみ</h2>
            <RoleDiagram you={status === "already_member" ? undefined : "member"} vertical />
          </div>
        </section>
      </div>
    </CenteredLayout>
  );
}

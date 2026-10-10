// 招待の確認（specs/008-team-operations contracts/ui-routes.md「招待の確認」、research.md R7）。
// ログインしていなくても開ける。「参加する」でGoogleログインへ進み、戻ったらもう一度確認してから参加する。
import { useAuth, useClerk } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InvitePreview } from "@threads-grower/shared";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AccountAvatar } from "@/components/AccountAvatar";
import { CenteredLayout } from "@/components/layout/AppShell";
import { LoadingSkeleton } from "@/components/guards";
import { Button } from "@/components/ui/button";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * 見出しの文言。
 * @param p - 招待の情報
 * @returns 見出し
 */
function headline(p: InvitePreview): string {
  if (p.kind === "partner") return `${p.inviterName}さんから、運用を手伝うパートナーとして招待されました`;
  return `${p.team?.name ?? p.inviterName}の編集者として招待されました`;
}

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
  const [teamName, setTeamName] = useState("");
  const preview = useQuery({
    // ログインの状態で「参加できるか」が変わるので、キーに含める
    queryKey: [...queryKeys.invite(token), Boolean(isSignedIn)],
    queryFn: () => api.previewInvite(token),
    enabled: isLoaded,
    retry: false,
  });
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, enabled: Boolean(isSignedIn) });
  const back = `/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`;

  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token, preview.data?.viewer.needsTeamName ? teamName : undefined),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void navigate(r.accountId ? `/accounts/${r.accountId}` : "/", { replace: true });
    },
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
              ? "作り直されたか、取り消されたか、すでにパートナーが参加しています。招待した方に、新しいリンクを頼んでください。"
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
  const abilities =
    p.kind === "partner"
      ? [
          "投稿の案・戦略を作る、直す。パフォーマンスを見る。あなたの会社のスタッフ（編集者）を担当にする。",
          `承認と設定は、${p.inviterName}さんが任せたときだけできます。`,
          `このアカウントの料金は、${p.inviterName}さんが払います。`,
        ]
      : [
          "担当になったアカウントで、投稿の案・戦略を作る、直す。",
          "承認と設定はできません。",
          "編集者は無料です。担当は、参加した後にパートナーが決めます。",
        ];

  return (
    <CenteredLayout>
      <div className="w-full max-w-md space-y-5">
        <div className="text-center text-base font-semibold">ThreadsGrower</div>
        <div className="space-y-5 rounded-2xl border bg-card p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            {p.account && <AccountAvatar account={p.account} className="size-14" />}
            {p.account && (
              <div className="leading-tight">
                <div className="font-semibold">{p.account.displayName ?? p.account.username}</div>
                <div className="text-sm text-muted-foreground">@{p.account.username}</div>
              </div>
            )}
            <h1 className="text-lg leading-snug font-semibold">{headline(p)}</h1>
          </div>
          <div className="space-y-1.5 rounded-xl bg-muted/50 p-4 text-sm">
            <div className="font-medium">参加すると</div>
            {abilities.map((a) => (
              <p key={a} className="text-foreground/80">
                {a}
              </p>
            ))}
          </div>

          {status === "anonymous" && (
            <Button className="h-12 w-full rounded-full" onClick={() => void navigate(back)}>
              Googleでログインして参加
            </Button>
          )}
          {status !== "anonymous" && me.data && (
            <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-medium">
                  {me.data.user.displayName ?? me.data.user.email} としてログイン中
                </div>
                <div className="truncate text-xs text-muted-foreground">{me.data.user.email}</div>
              </div>
              <Button
                variant="link"
                className="h-9 px-1 text-sm text-foreground underline"
                onClick={() => {
                  void signOut().then(() => {
                    queryClient.clear();
                    void navigate(back, { replace: true });
                  });
                }}
              >
                別のGoogleアカウント
              </Button>
            </div>
          )}
          {status === "can_join" && (
            <div className="space-y-4">
              {p.viewer.needsTeamName && (
                <div className="space-y-1.5">
                  <label htmlFor="team-name" className="text-sm font-medium">
                    チーム名（会社名）<span className="ml-1 text-xs text-muted-foreground">任意</span>
                  </label>
                  <input
                    id="team-name"
                    value={teamName}
                    maxLength={50}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="h-11 w-full rounded-xl border bg-background px-3 text-base md:text-sm"
                  />
                  <p className="text-xs text-muted-foreground">編集者を招くときや、オーナーの画面に出ます</p>
                </div>
              )}
              {accept.isError && <p className="text-sm text-destructive">{describeError(accept.error)}</p>}
              <Button className="h-12 w-full rounded-full" disabled={accept.isPending} onClick={() => accept.mutate()}>
                参加する
              </Button>
            </div>
          )}
          {status === "already_member" && (
            <div className="space-y-3 text-center">
              <p className="text-sm">すでに参加しています。</p>
              <Button asChild className="h-11 w-full rounded-full">
                <Link to={p.viewer.accountId ? `/accounts/${p.viewer.accountId}` : "/"}>開く</Link>
              </Button>
            </div>
          )}
          {status === "self" && (
            <p className="text-center text-sm text-muted-foreground">自分のアカウント（またはチーム）には参加できません。</p>
          )}
          {status === "limit_reached" && (
            <p className="text-center text-sm text-muted-foreground">
              編集者が上限（10人）に達しています。パートナーに相談してください。
            </p>
          )}
        </div>
      </div>
    </CenteredLayout>
  );
}

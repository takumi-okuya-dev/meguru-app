// テスト用のグループの招待（/test-invite/:token。specs/016-test-groups contracts/ui-routes.md 1、US1、FR-003・FR-004）。
// ログインしていなくても開ける。ログインのあと、注意を確かめて「参加する」を押した人だけがグループに入る。
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { CenteredLayout } from "@/shell/layout/AppShell";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { ApiError, api, describeError, setTestAccessRequired } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useLogout } from "@/lib/use-logout";
import { useEntryAppHome } from "../app-module";

/** 参加する前に確かめてもらうこと（contracts/ui-routes.md 1）。 */
const NOTES = [
  "料金はかかりません",
  "投稿は、つないだThreadsアカウントに実際に投稿されます",
  "テスト版のデータは本番版へは引き継がれません",
];

const FULL_MESSAGE = "このグループは定員に達しています。招待してくれた方に連絡してください。";

/**
 * グループの招待の画面。
 * @returns 画面
 */
export function TestInvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  // 参加したあと・「アプリを開く」は、すべてのアプリの画面を挟まずアプリのホームへ（specs/028 contracts/ui-routes.md 3）
  const entryHome = useEntryAppHome();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const preview = useQuery({
    // ログインの状態で「参加できるか」が変わるので、キーに含める
    queryKey: [...queryKeys.testInvite(token), Boolean(isSignedIn)],
    queryFn: () => api.previewTestInvite(token),
    enabled: isLoaded,
    retry: false,
  });
  const join = useMutation({
    mutationFn: () => api.joinTestGroup(token),
    onSuccess: async () => {
      setTestAccessRequired(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void navigate(entryHome, { replace: true });
    },
    onError: () => void preview.refetch(),
  });
  const here = `/test-invite/${token}`;

  if (!isLoaded || preview.isPending) return <LoadingSkeleton />;

  if (preview.isError) {
    const invalid = preview.error instanceof ApiError && preview.error.code === "TEST_INVITE_INVALID";
    return (
      <CenteredLayout>
        <div className="w-full max-w-md space-y-3 rounded-2xl border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">このリンクは使えません</h1>
          <p className="text-sm text-muted-foreground">
            {invalid ? "招待してくれた方に、新しいリンクをもらってください。" : describeError(preview.error)}
          </p>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/">トップへ</Link>
          </Button>
        </div>
      </CenteredLayout>
    );
  }

  const p = preview.data;
  const viewer = p.viewer;

  return (
    <CenteredLayout>
      <div className="w-full max-w-md space-y-5">
        <div className="text-center text-base font-semibold">ThreadsGrower</div>
        <section aria-labelledby="test-invite-title" className="space-y-5 rounded-2xl border bg-card p-6">
          <div className="space-y-1">
            {/* 本番では、グループは機能の設定にだけ使うので、テスト版のための注意を出さない（specs/019 FR-019） */}
            <h1 id="test-invite-title" className="text-lg font-semibold">
              {p.testVersion ? "テスト版に招待されています" : `${p.group.name}に招待されています`}
            </h1>
            {p.testVersion && <p className="text-sm text-muted-foreground">グループ：{p.group.name}</p>}
          </div>
          {p.testVersion && (
            <ul className="space-y-1.5 rounded-xl bg-muted/50 p-4 text-sm">
              {NOTES.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden="true">・</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {viewer === null &&
            (p.full ? (
              <p role="alert" className="text-sm text-destructive">
                {FULL_MESSAGE}
              </p>
            ) : (
              <Button
                className="h-12 w-full rounded-full"
                onClick={() => void navigate(`/sign-in?next=${encodeURIComponent(here)}`)}
              >
                Googleで始める
              </Button>
            ))}

          {viewer?.state === "can_join" && (
            <div className="space-y-2">
              <Button className="h-12 w-full rounded-full" disabled={join.isPending} onClick={() => join.mutate()}>
                参加する
              </Button>
              {join.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {describeError(join.error)}
                </p>
              )}
            </div>
          )}

          {viewer?.state === "full" && (
            <p role="alert" className="text-sm text-destructive">
              {FULL_MESSAGE}
            </p>
          )}

          {viewer?.state === "already_member" && (
            <div className="space-y-3">
              <p className="text-sm">すでに{viewer.groupName}に入っています。</p>
              <Button asChild className="h-12 w-full rounded-full">
                <Link to={entryHome}>アプリを開く</Link>
              </Button>
            </div>
          )}

          {isSignedIn && (
            <div className="text-center">
              <Button variant="link" className="h-9 text-sm text-muted-foreground" onClick={() => void logout()}>
                ログアウト
              </Button>
            </div>
          )}
        </section>
      </div>
    </CenteredLayout>
  );
}

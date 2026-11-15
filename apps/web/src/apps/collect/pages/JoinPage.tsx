// 運営メンバーの招待を受ける（/collect/join/:token。specs/collect/003-revenue-sharing User Story 5、FR-051・FR-052、tasks.md T026）。
// ログインしていなくても開ける。ログインしていなければ、ログインのあとでこの画面に戻る（外枠のテスト版の招待と同じやり方）。
// 集金管理の利用の許可はいらない。
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { formatJstShort } from "@/lib/format";
import { CenteredLayout } from "@/shell";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { sharePath, sharesPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";

/**
 * 招待を受ける画面。
 * @returns 画面
 */
export function JoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: collectQueryKeys.invite(token), queryFn: () => collectApi.invite(token), enabled: isLoaded && Boolean(isSignedIn), retry: false });
  const accept = useMutation({
    mutationFn: () => collectApi.acceptInvite(token),
    onSuccess: async ({ eventId }) => {
      await queryClient.invalidateQueries({ queryKey: collectQueryKeys.shares });
      void navigate(sharePath(eventId), { replace: true });
    },
  });
  const here = `/collect/join/${token}`;

  const card = (body: React.ReactNode) => (
    <CenteredLayout>
      <section aria-labelledby="join-title" className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6">
        {body}
      </section>
    </CenteredLayout>
  );

  if (!isLoaded) return <LoadingSkeleton />;
  if (!isSignedIn) {
    return card(
      <>
        <h1 id="join-title" className="text-lg font-semibold">
          イベントの運営メンバーに招待されています
        </h1>
        <p className="text-sm text-muted-foreground">めぐるにログインすると、招待を受けて、そのイベントの分配（あなたの受け取る額と計算のもと）を見られます。</p>
        <Button className="h-12 w-full rounded-full" onClick={() => void navigate(`/sign-in?next=${encodeURIComponent(here)}`)}>
          ログインして受ける
        </Button>
      </>,
    );
  }
  if (info.isPending) return <LoadingSkeleton />;
  if (info.isError) {
    const inactive = info.error instanceof ApiError && info.error.code === "INVITE_INACTIVE";
    return card(
      <>
        <h1 id="join-title" className="text-lg font-semibold">
          このリンクは使えません
        </h1>
        <p className="text-sm text-muted-foreground">{inactive ? "受けたあとか、期限が過ぎたか、止められたリンクです。主催者に聞いてください。" : collectErrorText(info.error)}</p>
        <Button asChild variant="outline" className="rounded-full">
          <Link to={sharesPath()}>運営メンバーのイベントへ</Link>
        </Button>
      </>,
    );
  }
  const i = info.data;
  return card(
    <>
      <div className="space-y-1">
        <h1 id="join-title" className="text-lg font-semibold">
          「{i.event.name}」の運営メンバーに招待されています
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatJstShort(i.event.startsAt)}・運営メンバーの名前：{i.memberName}
        </p>
      </div>
      {i.ownerIsYou ? (
        <p role="status" className="text-sm">
          あなたはこのイベントの主催者です。主催者は招待を受けなくても、集金管理の「分配」で見られます。
        </p>
      ) : i.alreadyLinked ? (
        <p role="status" className="text-sm">
          あなたはこのイベントの運営メンバーとして、もうつながっています。
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">受けると、このイベントの売上・経費・全員の分配額を見られます（読むだけ。参加者の名前は出ません）。</p>
          <Button className="h-12 w-full rounded-full" disabled={accept.isPending} onClick={() => accept.mutate()}>
            受ける
          </Button>
          {accept.isError && (
            <p role="alert" className="text-sm text-destructive">
              {collectErrorText(accept.error)}
            </p>
          )}
        </>
      )}
      <Button asChild variant="ghost" className="w-full">
        <Link to={sharesPath()}>運営メンバーのイベントへ</Link>
      </Button>
    </>,
  );
}

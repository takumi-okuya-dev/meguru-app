// ログイン画面（FR-001）。Clerk側で Google だけを有効にしているので、「Googleで続ける」ボタンだけが出る
import { SignIn, useAuth } from "@clerk/react";
import { Link, Navigate, useSearchParams } from "react-router";
import { CenteredLayout } from "@/shell/layout/AppShell";
import { ClerkLoadFailedScreen } from "@/components/ErrorScreen";
import { LoadingSkeleton, useLoadTimeout } from "@/components/LoadingSkeleton";
import { isInvitePath, isTestInvitePath } from "@/lib/invite-return";

/**
 * ログイン画面（FR-001）。Clerk 側で Google だけを有効にしているので、「Googleで続ける」だけが出る。
 * @returns ログイン画面
 */
export function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();
  // 招待の確認画面から来たときは、ログインの後にそこへ戻す（specs/008 research.md R7、specs/016 R8）。招待のURLだけを許す
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  // 退会の後に戻ってきた（specs/013 contracts/ui-routes.md「退会」）
  const withdrawn = params.get("withdrawn") === "1";
  const timedOut = useLoadTimeout(Boolean(isLoaded));
  if (timedOut) return <ClerkLoadFailedScreen />;
  if (!isLoaded) return <LoadingSkeleton />;
  if (isSignedIn) return <Navigate to={next} replace />;
  return (
    <CenteredLayout>
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-semibold">ThreadsGrower</h1>
        {withdrawn && (
          <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">
            退会しました。ご利用ありがとうございました。
          </p>
        )}
        <SignIn routing="path" path="/sign-in" forceRedirectUrl={next} />
        {/* 利用規約・特定商取引法に基づく表記はログインの前に読める（specs/010 FR-052、specs/013 FR-071） */}
        <div className="flex gap-4 text-xs text-muted-foreground">
          <Link to="/terms" className="underline underline-offset-4">
            利用規約
          </Link>
          <Link to="/legal/commerce" className="underline underline-offset-4">
            特定商取引法に基づく表記
          </Link>
        </div>
      </div>
    </CenteredLayout>
  );
}

/**
 * ログインの後に戻る先。チームの招待（/invite/t_…）・テスト用のグループの招待（/test-invite/g_…）・Threadsのホーム（/threads。紹介リンクから。specs/028）だけを許し、それ以外は `/`。
 * @param next - クエリの next
 * @returns 戻る先のパス
 */
export function safeNext(next: string | null): string {
  if (next === "/threads") return next;
  return isInvitePath(next) || isTestInvitePath(next) ? next : "/";
}

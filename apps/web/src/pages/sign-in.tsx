// ログイン画面（FR-001）。Clerk側で Google だけを有効にしているので、「Googleで続ける」ボタンだけが出る
import { SignIn, useAuth } from "@clerk/react";
import { Link, Navigate, useSearchParams } from "react-router";
import { CenteredLayout } from "@/components/layout/AppShell";
import { ClerkLoadFailedScreen } from "@/components/ErrorScreen";
import { LoadingSkeleton, useLoadTimeout } from "@/components/guards";
import { isInvitePath } from "@/lib/invite-return";

/**
 * ログイン画面（FR-001）。Clerk 側で Google だけを有効にしているので、「Googleで続ける」だけが出る。
 * @returns ログイン画面
 */
export function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();
  // 招待の確認画面から来たときは、ログインの後にそこへ戻す（specs/008 research.md R7）。招待のURLだけを許す
  const next = safeNext(useSearchParams()[0].get("next"));
  const timedOut = useLoadTimeout(Boolean(isLoaded));
  if (timedOut) return <ClerkLoadFailedScreen />;
  if (!isLoaded) return <LoadingSkeleton />;
  if (isSignedIn) return <Navigate to={next} replace />;
  return (
    <CenteredLayout>
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-semibold">ThreadsGrower</h1>
        <SignIn routing="path" path="/sign-in" forceRedirectUrl={next} />
        {/* 利用規約はログインの前に読める（specs/010 FR-052） */}
        <Link to="/terms" className="text-xs text-muted-foreground underline underline-offset-4">
          利用規約
        </Link>
      </div>
    </CenteredLayout>
  );
}

/**
 * ログインの後に戻る先。招待の確認画面（/invite/…）だけを許し、それ以外は `/`。
 * @param next - クエリの next
 * @returns 戻る先のパス
 */
export function safeNext(next: string | null): string {
  return isInvitePath(next) ? next : "/";
}

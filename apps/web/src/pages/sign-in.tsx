// ログイン画面（FR-001）。Clerk側で Google だけを有効にしているので、「Googleで続ける」ボタンだけが出る
import { SignIn, useAuth } from "@clerk/react";
import { Navigate } from "react-router";
import { CenteredLayout } from "@/components/layout/AppShell";
import { LoadingSkeleton } from "@/router";

export function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingSkeleton />;
  if (isSignedIn) return <Navigate to="/" replace />;
  return (
    <CenteredLayout>
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-semibold">ThreadsGrower</h1>
        <SignIn routing="path" path="/sign-in" forceRedirectUrl="/" />
      </div>
    </CenteredLayout>
  );
}

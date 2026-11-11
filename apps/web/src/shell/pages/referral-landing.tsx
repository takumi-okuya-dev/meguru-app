// 紹介リンクの画面（/r/:code。specs/017-referral-links contracts/ui-routes.md 1、US1・US3）。
// ログインしていなくても開ける。開いたことをブラウザに覚え、そのあと登録すると紹介した人が記録される。
// 紹介した人の名前は出さない（リンクが転送されても、知らない人に名前が伝わらない）。
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { CenteredLayout } from "@/shell/layout/AppShell";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { rememberReferral } from "@/lib/referral-store";

/** アプリの紹介（contracts/ui-routes.md 1）。 */
const FEATURES = [
  "Threadsの投稿案を、戦略に沿って作れます",
  "承認した投稿だけを、決めた時刻に自動で投稿します",
  "投稿の反応を取り込み、次の案に生かせます",
];

/**
 * 紹介リンクの画面。
 * @returns 画面
 */
export function ReferralLandingPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  // テスト版なら注意を出す。読めなくても画面は出す（注意を出さないだけ）
  const page = useQuery({ queryKey: queryKeys.referralPage, queryFn: () => api.referralPage(), retry: false });
  const signedOut = isLoaded && !isSignedIn;
  useEffect(() => {
    // すでに登録している人（ログイン中）は覚えない（FR-005）
    if (signedOut) rememberReferral(code);
  }, [signedOut, code]);

  if (!isLoaded) return <LoadingSkeleton />;
  if (isSignedIn) return <Navigate to="/" replace />;

  return (
    <CenteredLayout>
      <div className="w-full max-w-md space-y-5">
        <div className="text-center text-base font-semibold">ThreadsGrower</div>
        <section aria-labelledby="referral-title" className="space-y-5 rounded-2xl border bg-card p-6">
          <h1 id="referral-title" className="text-lg font-semibold">
            ThreadsGrowerに招待されています
          </h1>
          <ul className="space-y-1.5 rounded-xl bg-muted/50 p-4 text-sm">
            {FEATURES.map((f) => (
              <li key={f} className="flex gap-2">
                <span aria-hidden="true">・</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          {page.data?.testGroups && (
            <p className="text-sm text-muted-foreground">
              テスト版は、招待された方だけが使えます。招待のリンクを受け取った方は、そちらから始めてください。
            </p>
          )}
          <Button className="h-12 w-full rounded-full" onClick={() => void navigate("/sign-in")}>
            Googleで始める
          </Button>
        </section>
      </div>
    </CenteredLayout>
  );
}

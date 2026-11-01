// テスト版に入れない人の画面（specs/016-test-groups contracts/ui-routes.md 2）。
// 招待のリンク（/test-invite/:token）はこの画面にならない（認証のガードの外）。
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { CenteredLayout } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { api, setTestAccessRequired } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useLogout } from "@/lib/use-logout";

/**
 * テスト版は招待された方だけが使える、と伝える画面。
 * @returns 画面
 */
export function TestAccessRequired() {
  const logout = useLogout();
  // 開いたときに読み直す。別のタブでグループに入った・運営者が入れ直した場合は、me の応答で元の画面に戻る
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const admitted = me.data ? !me.data.testGroups.enabled || me.data.testGroups.admitted : false;
  useEffect(() => {
    if (admitted) setTestAccessRequired(false);
  }, [admitted]);
  return (
    <CenteredLayout>
      <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">テスト版は招待された方だけが使えます</h1>
        <p className="text-sm text-muted-foreground">
          招待のリンクを受け取った方は、そのリンクをもう一度開いてください。別のGoogleアカウントでログインしている場合は、ログアウトしてから入り直してください。
        </p>
        <Button variant="outline" className="rounded-full" onClick={() => void logout()}>
          ログアウト
        </Button>
      </div>
    </CenteredLayout>
  );
}

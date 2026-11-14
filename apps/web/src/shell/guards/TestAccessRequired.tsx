// テスト版に入れない人の画面（specs/016-test-groups contracts/ui-routes.md 2）。
// 招待のリンク（/test-invite/:token）はこの画面にならない（認証のガードの外）。
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { CenteredLayout } from "@/shell/layout/AppShell";
import { Button } from "@/components/ui/button";
import { api, setTestAccessRequired } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useLogout } from "@/lib/use-logout";

/** 招待のリンクを開き直すときの案内（specs/016 contracts/ui-routes.md 2）。 */
const GUIDE = [
  "ログインしたままで大丈夫です",
  "開いた画面で「参加する」を押すと使えます",
  "別のGoogleアカウントで入っている場合は、ログアウトしてから入り直してください",
] as const;

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
        {/* 招待のリンクを通らずにログインした人が、ここで止まることが多い（2026-11-04） */}
        <p className="text-sm">届いた招待のリンクを、このブラウザで開き直してください。</p>
        <ul className="space-y-1 rounded-xl bg-muted/50 p-4 text-left text-[13px] text-foreground/80">
          {GUIDE.map((g) => (
            <li key={g}>・{g}</li>
          ))}
        </ul>
        <Button variant="outline" className="rounded-full" onClick={() => void logout()}>
          ログアウト
        </Button>
      </div>
    </CenteredLayout>
  );
}

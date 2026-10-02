// 設定 > アカウント：ログイン中のGoogleアカウントとログアウト（FR-001・FR-006）
import { useUser } from "@clerk/react";
import { SettingCard, SettingRow } from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/lib/use-logout";

/**
 * 設定 > アカウント。ログイン中の Google アカウントとログアウト（FR-001・FR-006）。
 * @returns アカウントの設定
 */
export function AccountSettingsPage() {
  const { user } = useUser();
  const logout = useLogout();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">アカウント</h1>
      <SettingCard>
        <SettingRow label="名前" description={user?.fullName || "—"} />
        <SettingRow label="メールアドレス" description={user?.primaryEmailAddress?.emailAddress || "—"} />
        <SettingRow label="ログイン方法" description="Googleアカウント" />
      </SettingCard>
      <SettingCard>
        <SettingRow label="ログアウト" description="このブラウザからログアウトします">
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            ログアウト
          </Button>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

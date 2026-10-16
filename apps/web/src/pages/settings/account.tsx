// 設定 > アカウント：ログイン中のGoogleアカウントとログアウト（FR-001・FR-006）、退会（specs/013 FR-050）
import { useUser } from "@clerk/react";
import { useState } from "react";
import { WithdrawDialog } from "@/components/billing/WithdrawDialog";
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
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold max-md:hidden">アカウント</h1>
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
      {/* 危険な操作は、ほかの操作と離して置く */}
      <div className="pt-6">
        <SettingCard>
          <SettingRow label="退会" description="退会すると、あなたのアカウントとデータがすべて消え、元に戻せません">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setWithdrawOpen(true)}
            >
              退会する
            </Button>
          </SettingRow>
        </SettingCard>
      </div>
      <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} />
    </div>
  );
}

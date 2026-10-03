// Accountのホーム（US1）。本featureでは、プロフィールと接続状態だけを表示する。後続featureがここに機能を足す
import { useCallbackResult } from "@/lib/callback-result";
import { AccountAvatar } from "@/components/AccountAvatar";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { useCurrentAccount } from "@/pages/account-layout";

/**
 * Account のホーム（US1）。本featureでは、プロフィールと接続状態だけを表示する。後続featureがここに機能を足す。
 * @returns Account のホーム
 */
export function AccountHome() {
  const account = useCurrentAccount();
  useCallbackResult({ username: account.username });
  return (
    <>
      <PageHeader title="ホーム" />
      <PageBody>
        <section className="flex items-center gap-4">
          <AccountAvatar account={account} className="size-16 text-lg" />
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-xl font-semibold">
              {account.displayName ?? account.username}
            </h1>
            <p className="text-sm text-muted-foreground">@{account.username}</p>
            <ConnectionBadge status={account.connectionStatus} />
          </div>
        </section>
      </PageBody>
    </>
  );
}

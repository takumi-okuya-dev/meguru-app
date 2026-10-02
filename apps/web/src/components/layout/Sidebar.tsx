import { AccountSwitcher } from "./AccountSwitcher";
import { UserMenu } from "./UserMenu";

/**
 * サイドバーの中身。Account の一覧とユーザーメニュー。
 * @returns サイドバー
 */
export function Sidebar() {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-3 text-sm font-semibold">ThreadsGrower</div>
      <nav className="flex-1 overflow-y-auto px-2" aria-label="Account">
        <AccountSwitcher />
      </nav>
      <div className="border-t p-2">
        <UserMenu />
      </div>
    </div>
  );
}

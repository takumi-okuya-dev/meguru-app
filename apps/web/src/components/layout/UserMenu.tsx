// サイドバー左下のユーザーメニュー。名前とメールアドレス、設定、ログアウト（FR-006）
import { useUser } from "@clerk/react";
import { ChevronsUpDownIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout } from "@/lib/use-logout";

/**
 * サイドバー左下のユーザーメニュー。名前とメールアドレス、設定、ログアウト（FR-006）。
 * @returns ユーザーメニュー
 */
export function UserMenu() {
  const { user } = useUser();
  const logout = useLogout();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const name = user?.fullName || email || "ユーザー";
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs">{initial}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="truncate">{name}</div>
          {email && <div className="truncate text-xs font-normal text-muted-foreground">{email}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <SettingsIcon className="size-4" /> 設定
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOutIcon className="size-4" /> ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

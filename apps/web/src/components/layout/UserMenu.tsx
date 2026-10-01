// ユーザーメニューとログアウト（FR-006、規則6）。
// ログアウトは Clerk のセッションを終了し、TanStack Query のキャッシュを全部消してから /sign-in へ置き換え遷移する
import { useClerk, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logout = async () => {
    await signOut();
    queryClient.clear();
    void navigate("/sign-in", { replace: true });
  };

  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "ユーザー";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="truncate">{user?.primaryEmailAddress?.emailAddress}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOutIcon className="size-4" /> ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

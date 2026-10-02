// ログアウト（FR-006、規則6）。Clerk のセッションを終了し、TanStack Query のキャッシュを全部消してから /sign-in へ置き換え遷移する
import { useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

export function useLogout() {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await signOut();
    queryClient.clear();
    void navigate("/sign-in", { replace: true });
  };
}

// チームの画面（/threads/teams/:teamId と担当の表）の共通の親（specs/011-team-revision contracts/ui-routes.md「ルート」）。
// サイドバーの中に出す（今のサイドバーの構造のまま。サイドバーの機能は、最後に使ったAccountへ移る）。
import { Outlet } from "react-router";
import { TrialEndingBannerFromMe } from "@/components/billing/TrialEndingBanner";
import { ThreadsShell } from "../sidebar";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesProvider";

/**
 * チームの画面の骨格。
 * @returns 骨格
 */
export function TeamLayout() {
  return (
    <ThreadsShell banner={<TrialEndingBannerFromMe />}>
      <UnsavedChangesProvider>
        <Outlet />
      </UnsavedChangesProvider>
    </ThreadsShell>
  );
}

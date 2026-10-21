// ルートとガード（contracts/ui-routes.md「ルート」「遷移の規則」）
import { createBrowserRouter, Outlet } from "react-router";
import { RequireAuth } from "@/components/guards";
import { AccountLayout } from "@/pages/account-layout";
import { AccountHome } from "@/pages/account-home";
import { AccountNew } from "@/pages/account-new";
import { AccountSettings } from "@/pages/account-settings";
import { ActivityPage } from "@/pages/activity";
import { DataDeletion } from "@/pages/data-deletion";
import { InvitePage } from "@/pages/invite";
import { Landing } from "@/pages/landing";
import { NotFound } from "@/pages/not-found";
import { PerformancePage } from "@/pages/performance";
import { TeamPage } from "@/pages/team";
import { TeamAssignPage } from "@/pages/team-assign";
import { TeamLayout } from "@/pages/team-layout";
import { TeamSharedAccountPage } from "@/pages/team-shared-account";
import { SignInPage } from "@/pages/sign-in";
import { AccountSettingsPage } from "@/pages/settings/account";
import { BillingSettingsPage } from "@/pages/settings/billing";
import { LegalCommercePage } from "@/pages/legal-commerce";
import { AppearanceSettings } from "@/pages/settings/appearance";
import { SettingsIndex, SettingsLayout } from "@/pages/settings/settings-layout";
import { PromotionsPage } from "@/pages/promotions";
import { ResearchPage } from "@/pages/research";
import { StockPage } from "@/pages/stock";
import { CreatePage } from "@/pages/create";
import { StrategyPage } from "@/pages/strategy";
import { TermsPage } from "@/pages/terms";
import { GuideThreadsTokenPage } from "@/pages/guide-threads-token";
import { EnvBanner } from "@/components/layout/EnvBanner";

/**
 * 骨格を使わない読みもののページの入れ物。環境の帯を画面の一番上に出す（specs/015 contracts/ui-routes.md 1）。
 * @returns 帯と、中の画面
 */
function PlainPage() {
  return (
    <>
      <EnvBanner />
      <Outlet />
    </>
  );
}

/** 画面のルート（contracts/ui-routes.md「ルート」）。認証が必要な画面は RequireAuth で包む。 */
export const routes = [
  { path: "/sign-in/*", element: <SignInPage /> },
  { path: "/data-deletion/:code", element: <DataDeletion /> },
  // 利用規約・トークンの作り方はログインなしで読める（specs/010 FR-052・FR-030）
  {
    element: <PlainPage />,
    children: [
      { path: "/terms", element: <TermsPage /> },
      { path: "/legal/commerce", element: <LegalCommercePage /> },
      { path: "/guide/threads-token", element: <GuideThreadsTokenPage /> },
    ],
  },
  // 招待の確認はログインなしで開ける（specs/008 research.md R7、specs/011 contracts/ui-routes.md）
  { path: "/invite/:token", element: <InvitePage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/accounts/new", element: <AccountNew /> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsIndex /> },
          { path: "appearance", element: <AppearanceSettings /> },
          { path: "account", element: <AccountSettingsPage /> },
          { path: "billing", element: <BillingSettingsPage /> },
        ],
      },
      // チーム（specs/011 contracts/ui-routes.md「ルート」）。チームの画面と担当の表はサイドバーの中に出す
      {
        path: "/teams/:teamId",
        element: <TeamLayout />,
        children: [
          { index: true, element: <TeamPage /> },
          { path: "assign", element: <TeamAssignPage /> },
        ],
      },
      // 見せてもらっているアカウントは、読むだけの1カラムの画面（Accountのサイドバーには入らない）
      { path: "/teams/:teamId/accounts/:accountId", element: <TeamSharedAccountPage /> },
      {
        path: "/accounts/:accountId",
        element: <AccountLayout />,
        children: [
          { index: true, element: <AccountHome /> },
          { path: "settings", element: <AccountSettings /> },
          { path: "strategy", element: <StrategyPage /> },
          { path: "promotions", element: <PromotionsPage /> },
          { path: "research", element: <ResearchPage /> },
          // 投稿をつくる（specs/014 US15）。投稿ストックは一覧だけにした
          { path: "create", element: <CreatePage /> },
          { path: "stock", element: <StockPage /> },
          { path: "performance", element: <PerformancePage /> },
          // 操作の記録（specs/008 FR-052）。オーナーと、担当の管理者だけ（specs/011 FR-002）
          { path: "activity", element: <ActivityPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

/** アプリのルーター。 */
export const router = createBrowserRouter(routes);

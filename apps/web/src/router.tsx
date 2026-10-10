// ルートとガード（contracts/ui-routes.md「ルート」「遷移の規則」）
import { createBrowserRouter } from "react-router";
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
import { PartnerAccountsPage } from "@/pages/partner/partner-accounts";
import { PartnerEditorsPage } from "@/pages/partner/partner-editors";
import { PartnerLayout } from "@/pages/partner/partner-layout";
import { PerformancePage } from "@/pages/performance";
import { SignInPage } from "@/pages/sign-in";
import { AccountSettingsPage } from "@/pages/settings/account";
import { AppearanceSettings } from "@/pages/settings/appearance";
import { SettingsIndex, SettingsLayout } from "@/pages/settings/settings-layout";
import { PromotionsPage } from "@/pages/promotions";
import { ResearchPage } from "@/pages/research";
import { StockPage } from "@/pages/stock";
import { StrategyPage } from "@/pages/strategy";
import { TermsPage } from "@/pages/terms";
import { GuideThreadsTokenPage } from "@/pages/guide-threads-token";

/** 画面のルート（contracts/ui-routes.md「ルート」）。認証が必要な画面は RequireAuth で包む。 */
export const routes = [
  { path: "/sign-in/*", element: <SignInPage /> },
  { path: "/data-deletion/:code", element: <DataDeletion /> },
  // 利用規約・トークンの作り方はログインなしで読める（specs/010 FR-052・FR-030）
  { path: "/terms", element: <TermsPage /> },
  { path: "/guide/threads-token", element: <GuideThreadsTokenPage /> },
  // 招待の確認はログインなしで開ける（specs/008 research.md R7）
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
        ],
      },
      // パートナーの画面（specs/008 FR-060）。チームのパートナーでなければ / へ移す
      {
        path: "/partner",
        element: <PartnerLayout />,
        children: [
          { path: "accounts", element: <PartnerAccountsPage /> },
          { path: "editors", element: <PartnerEditorsPage /> },
        ],
      },
      {
        path: "/accounts/:accountId",
        element: <AccountLayout />,
        children: [
          { index: true, element: <AccountHome /> },
          { path: "settings", element: <AccountSettings /> },
          { path: "strategy", element: <StrategyPage /> },
          { path: "promotions", element: <PromotionsPage /> },
          { path: "research", element: <ResearchPage /> },
          { path: "stock", element: <StockPage /> },
          { path: "performance", element: <PerformancePage /> },
          // 操作の記録（specs/008 FR-052）。オーナー・パートナーだけ
          { path: "activity", element: <ActivityPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

/** アプリのルーター。 */
export const router = createBrowserRouter(routes);

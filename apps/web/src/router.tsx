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
import { TestInvitePage } from "@/pages/test-invite";
import { ReferralLandingPage } from "@/pages/referral-landing";
import { ReferralSettingsPage } from "@/pages/settings/referral";
import { Landing } from "@/pages/landing";
import { NotFound } from "@/pages/not-found";
import { RequireFeature } from "@/components/FeatureUnavailable";
import { PerformancePage } from "@/pages/performance";
import { TeamPage } from "@/pages/team";
import { TeamAssignPage } from "@/pages/team-assign";
import { TeamStatusPage } from "@/pages/team-status";
import { TeamLayout } from "@/pages/team-layout";
import { TeamSharedAccountPage } from "@/pages/team-shared-account";
import { SignInPage } from "@/pages/sign-in";
import { AccountSettingsPage } from "@/pages/settings/account";
import { BillingSettingsPage } from "@/pages/settings/billing";
import { FeaturesPage } from "@/pages/settings/features";
import { TestGroupDetailPage, TestGroupsPage } from "@/pages/settings/test-groups";
import { LegalCommercePage } from "@/pages/legal-commerce";
import { AppearanceSettings } from "@/pages/settings/appearance";
import { SettingsIndex, SettingsLayout } from "@/pages/settings/settings-layout";
import { PromotionsPage } from "@/pages/promotions";
import { ExternalMediaPage } from "@/pages/external-media";
import { ExternalMediaListingPage } from "@/pages/external-media-listing";
import { ResearchPage } from "@/pages/research";
import { StockPage } from "@/pages/stock";
import { ThreadsComplete } from "@/pages/threads-complete";
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
  // テスト用のグループの招待もログインなしで開ける。テスト版に入れない人も開ける（specs/016 contracts/ui-routes.md 1）
  { path: "/test-invite/:token", element: <TestInvitePage /> },
  // 紹介リンクもログインなしで開ける（specs/017 contracts/ui-routes.md 1）
  { path: "/r/:code", element: <ReferralLandingPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/accounts/new", element: <AccountNew /> },
      // Threads から戻ってきた人の受け口。接続の完了はログイン済みでしか行えない
      // （state を作った人と呼び出し元の一致を要求する。セキュリティ監査 run-1）
      { path: "/threads/complete", element: <ThreadsComplete /> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsIndex /> },
          { path: "appearance", element: <AppearanceSettings /> },
          { path: "account", element: <AccountSettingsPage /> },
          { path: "billing", element: <BillingSettingsPage /> },
          { path: "referral", element: <ReferralSettingsPage /> },
          // 運営者だけ（specs/016 contracts/ui-routes.md 3）。運営者でなければ画面の中で断る
          { path: "features", element: <FeaturesPage /> },
          { path: "test-groups", element: <TestGroupsPage /> },
          { path: "test-groups/:groupId", element: <TestGroupDetailPage /> },
        ],
      },
      // チーム（specs/011 contracts/ui-routes.md「ルート」）。チームの画面と担当の表はサイドバーの中に出す
      {
        path: "/teams/:teamId",
        element: <TeamLayout />,
        children: [
          { index: true, element: <TeamPage /> },
          { path: "assign", element: <TeamAssignPage /> },
          { path: "status", element: <TeamStatusPage /> },
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
          // 機能のまとまりがOFFなら「この機能は今は使えません」（specs/019 FR-006）
          { path: "strategy", element: <RequireFeature feature="strategy"><StrategyPage /></RequireFeature> },
          { path: "promotions", element: <RequireFeature feature="strategy"><PromotionsPage /></RequireFeature> },
          // 外部媒体展開（specs/021 contracts/ui-routes.md）。作業の画面は ?view=work
          { path: "external-media", element: <RequireFeature feature="strategy"><ExternalMediaPage /></RequireFeature> },
          { path: "external-media/:promotionId/:media", element: <RequireFeature feature="strategy"><ExternalMediaListingPage /></RequireFeature> },
          { path: "research", element: <RequireFeature feature="strategy"><ResearchPage /></RequireFeature> },
          // 投稿をつくる（specs/014 US15）。投稿ストックは一覧だけにした
          { path: "create", element: <RequireFeature feature="autopost"><CreatePage /></RequireFeature> },
          { path: "stock", element: <RequireFeature feature="autopost"><StockPage /></RequireFeature> },
          { path: "performance", element: <RequireFeature feature="autopost"><PerformancePage /></RequireFeature> },
          // 操作の記録（specs/008 FR-052）。オーナーと、担当の管理者だけ（specs/011 FR-002）
          { path: "activity", element: <RequireFeature feature="team"><ActivityPage /></RequireFeature> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

/** アプリのルーター。 */
export const router = createBrowserRouter(routes);

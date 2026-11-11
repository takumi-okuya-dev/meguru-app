// Threadsのルート（contracts/ui-routes.md「ルート」「遷移の規則」、specs/028-meguru-shell contracts/ui-routes.md 1）。
import type { RouteObject } from "react-router";
import { AccountHomeLink } from "./components/AccountHomeLink";
import { RequireFeature } from "./components/FeatureUnavailable";
import { AccountHome } from "./pages/account-home";
import { AccountLayout } from "./pages/account-layout";
import { AccountNew } from "./pages/account-new";
import { AccountSettings } from "./pages/account-settings";
import { ActivityPage } from "./pages/activity";
import { AnalysisPage } from "./pages/analysis";
import { CreatePage } from "./pages/create";
import { DataDeletion } from "./pages/data-deletion";
import { ExternalMediaPage } from "./pages/external-media";
import { ExternalMediaListingPage } from "./pages/external-media-listing";
import { GuideThreadsTokenPage } from "./pages/guide-threads-token";
import { Landing } from "./pages/home";
import { InvitePage } from "./pages/invite";
import { PerformancePage } from "./pages/performance";
import { PromotionsPage } from "./pages/promotions";
import { ResearchPage } from "./pages/research";
import { StockPage } from "./pages/stock";
import { StrategyPage } from "./pages/strategy";
import { TeamPage } from "./pages/team";
import { TeamAssignPage } from "./pages/team-assign";
import { TeamLayout } from "./pages/team-layout";
import { TeamSharedAccountPage } from "./pages/team-shared-account";
import { TeamStatusPage } from "./pages/team-status";
import { ThreadsComplete } from "./pages/threads-complete";

/** アカウントの画面（/threads/accounts/:accountId）の子。 */
const ACCOUNT_CHILDREN: RouteObject[] = [
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
  { path: "analysis", element: <RequireFeature feature="autopost"><AnalysisPage /></RequireFeature> },
  // 操作の記録（specs/008 FR-052）。オーナーと、担当の管理者だけ（specs/011 FR-002）
  { path: "activity", element: <RequireFeature feature="team"><ActivityPage /></RequireFeature> },
];

/** ログインの要るルート。 */
export const threadsRoutes: RouteObject[] = [
  { path: "/threads", element: <Landing /> },
  { path: "/threads/accounts/new", element: <AccountNew /> },
  // Threads から戻ってきた人の受け口。接続の完了はログイン済みでしか行えない
  // （state を作った人と呼び出し元の一致を要求する。セキュリティ監査 run-1）
  { path: "/threads/complete", element: <ThreadsComplete /> },
  // チーム（specs/011 contracts/ui-routes.md「ルート」）。チームの画面と担当の表はサイドバーの中に出す
  {
    path: "/threads/teams/:teamId",
    element: <TeamLayout />,
    children: [
      { index: true, element: <TeamPage /> },
      { path: "assign", element: <TeamAssignPage /> },
      { path: "status", element: <TeamStatusPage /> },
    ],
  },
  // アカウントの画面では、使えない機能の案内の「ホームへ」をこのアカウントのホームにする（AccountHomeLink。specs/028 research.md R1）
  {
    element: <AccountHomeLink />,
    children: [
      // 見せてもらっているアカウントは、読むだけの1カラムの画面（Accountのサイドバーには入らない）
      { path: "/threads/teams/:teamId/accounts/:accountId", element: <TeamSharedAccountPage /> },
      { path: "/threads/accounts/:accountId", element: <AccountLayout />, children: ACCOUNT_CHILDREN },
    ],
  },
];

/** ログインのいらないルート（サイドバーの外。URLは Meta に登録・外部に配ったものなので変えない。specs/028 research.md R5）。 */
export const threadsPublicRoutes: RouteObject[] = [
  { path: "/data-deletion/:code", element: <DataDeletion /> },
  // 招待の確認はログインなしで開ける（specs/008 research.md R7、specs/011 contracts/ui-routes.md）
  { path: "/invite/:token", element: <InvitePage /> },
];

/** ログインのいらない読みもの（環境の帯つき。specs/010 FR-030）。 */
export const threadsReadingRoutes: RouteObject[] = [{ path: "/guide/threads-token", element: <GuideThreadsTokenPage /> }];

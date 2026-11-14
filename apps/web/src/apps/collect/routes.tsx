// 集金管理のルート（specs/collect/001-event-day-collection contracts/ui-routes.md 1、tasks.md T019）。
// 利用の許可のない人（/api/me の available に collect がない）には、集金管理の画面を出さず「使えない」の案内だけを出す。
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, type RouteObject } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { CenteredLayout } from "@/shell";
import { COLLECT_BASE, HELPER_RECEPTION_ROUTE, JOIN_ROUTE, SELF_CHECK_IN_ROUTE, sharesPath } from "./lib/paths";
import { collectApi } from "./lib/api";
import { collectQueryKeys } from "./lib/query-keys";
import { ClosingPage } from "./pages/ClosingPage";
import { EventEditPage } from "./pages/EventEditPage";
import { EventNewPage } from "./pages/EventNewPage";
import { EventsPage } from "./pages/EventsPage";
import { HelperReceptionPage } from "./pages/HelperReceptionPage";
import { HelpersPage } from "./pages/HelpersPage";
import { JoinPage } from "./pages/JoinPage";
import { ReceptionPage } from "./pages/ReceptionPage";
import { RosterPage } from "./pages/RosterPage";
import { SelfCheckInPage } from "./pages/SelfCheckInPage";
import { SelfCheckInPublicPage } from "./pages/SelfCheckInPublicPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ShareDetailPage, SharesPage } from "./pages/SharesPage";
import { SharingPage } from "./pages/SharingPage";
import { SummariesPage } from "./pages/SummariesPage";
import { TransfersPage } from "./pages/TransfersPage";
import { CollectShell } from "./sidebar/CollectShell";

/**
 * 集金管理を使える人にだけ、集金管理の骨格と画面を出す。
 * @returns 画面
 */
export function CollectLayout() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  if (me.isPending) return <LoadingSkeleton />;
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data.apps.available.includes("collect")) {
    return (
      <CenteredLayout>
        <div className="space-y-4 text-center">
          <h1 className="text-lg font-semibold">このアプリは今は使えません</h1>
          <p className="text-sm text-muted-foreground">集金管理はテスト版で、運営者が開いた人だけが使えます。</p>
          <SharesEntry />
          <Button asChild variant="outline">
            <Link to="/apps">すべてのアプリへ</Link>
          </Button>
        </div>
      </CenteredLayout>
    );
  }
  return (
    <CollectShell>
      <Outlet />
    </CollectShell>
  );
}

/**
 * 運営メンバーとしてつながったイベントがあれば、その入口を出す（利用の許可がなくても見られる。specs/collect/003 research.md R7）。
 * @returns 入口（なければ何も出さない）
 */
function SharesEntry() {
  const shares = useQuery({ queryKey: collectQueryKeys.shares, queryFn: collectApi.shares });
  if (!shares.data || shares.data.events.length === 0) return null;
  return (
    <Button asChild>
      <Link to={sharesPath()}>運営メンバーのイベントを見る（{shares.data.events.length}件）</Link>
    </Button>
  );
}

/** ログインの要るルート。 */
export const collectRoutes: RouteObject[] = [
  {
    element: <CollectLayout />,
    children: [
      { path: COLLECT_BASE, element: <EventsPage /> },
      { path: `${COLLECT_BASE}/events/new`, element: <EventNewPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/edit`, element: <EventEditPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/roster`, element: <RosterPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/reception`, element: <ReceptionPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/helpers`, element: <HelpersPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/self`, element: <SelfCheckInPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/closing`, element: <ClosingPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/sharing`, element: <SharingPage /> },
      { path: `${COLLECT_BASE}/transfers`, element: <TransfersPage /> },
      { path: `${COLLECT_BASE}/summaries`, element: <SummariesPage /> },
      { path: `${COLLECT_BASE}/settings`, element: <SettingsPage /> },
    ],
  },
  // つながった運営メンバー（集金管理の骨格と利用の許可の確かめの外。specs/collect/003 research.md R7）
  { path: `${COLLECT_BASE}/shares`, element: <SharesPage /> },
  { path: `${COLLECT_BASE}/shares/:eventId`, element: <ShareDetailPage /> },
];

/** ログインのいらないルート（手伝う人の受付。specs/collect/001 contracts/ui-routes.md。参加者のセルフ受付。specs/collect/002。運営メンバーの招待。specs/collect/003）。 */
export const collectPublicRoutes: RouteObject[] = [
  { path: HELPER_RECEPTION_ROUTE, element: <HelperReceptionPage /> },
  { path: SELF_CHECK_IN_ROUTE, element: <SelfCheckInPublicPage /> },
  { path: JOIN_ROUTE, element: <JoinPage /> },
];

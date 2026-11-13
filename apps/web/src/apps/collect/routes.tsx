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
import { COLLECT_BASE } from "./lib/paths";
import { EventEditPage } from "./pages/EventEditPage";
import { EventNewPage } from "./pages/EventNewPage";
import { EventsPage } from "./pages/EventsPage";
import { RosterPage } from "./pages/RosterPage";
import { SettingsPage } from "./pages/SettingsPage";
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

/** ログインの要るルート。 */
export const collectRoutes: RouteObject[] = [
  {
    element: <CollectLayout />,
    children: [
      { path: COLLECT_BASE, element: <EventsPage /> },
      { path: `${COLLECT_BASE}/events/new`, element: <EventNewPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/edit`, element: <EventEditPage /> },
      { path: `${COLLECT_BASE}/events/:eventId/roster`, element: <RosterPage /> },
      { path: `${COLLECT_BASE}/settings`, element: <SettingsPage /> },
    ],
  },
];

// 人物メモのルート（specs/people/001-people-memo contracts/ui-routes.md 1）。すべてログインが要り、サイドバーの中に出す。
// 利用の許可がない人には、共通の親（PeopleLayout）が「使えない」画面を出す。
import type { RouteObject } from "react-router";
import { EventNewPage } from "./pages/EventNewPage";
import { EventPage } from "./pages/EventPage";
import { EventsPage } from "./pages/EventsPage";
import { HomePage } from "./pages/HomePage";
import { ImportPage } from "./pages/ImportPage";
import { PEOPLE_BASE } from "./lib/paths";
import { PeopleLayout } from "./shell/PeopleLayout";

/** ログインの要るルート。 */
export const peopleRoutes: RouteObject[] = [
  {
    path: PEOPLE_BASE,
    element: <PeopleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "import", element: <ImportPage /> },
      { path: "events", element: <EventsPage /> },
      { path: "events/new", element: <EventNewPage /> },
      { path: "events/:eventId", element: <EventPage /> },
    ],
  },
];

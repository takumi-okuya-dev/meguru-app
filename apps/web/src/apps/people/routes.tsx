// 人物メモのルート（specs/people/001-people-memo contracts/ui-routes.md 1）。すべてログインが要り、サイドバーの中に出す。
// 利用の許可がない人には、共通の親（PeopleLayout）が「使えない」画面を出す。
import type { RouteObject } from "react-router";
import { CandidatesPage } from "./pages/CandidatesPage";
import { EventNewPage } from "./pages/EventNewPage";
import { EventPage } from "./pages/EventPage";
import { EventsPage } from "./pages/EventsPage";
import { ImportPage } from "./pages/ImportPage";
import { PeopleListPage } from "./pages/PeopleListPage";
import { PersonNewPage } from "./pages/PersonNewPage";
import { PersonPage } from "./pages/PersonPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PEOPLE_BASE } from "./lib/paths";
import { PeopleLayout } from "./shell/PeopleLayout";

/** ログインの要るルート。 */
export const peopleRoutes: RouteObject[] = [
  {
    path: PEOPLE_BASE,
    element: <PeopleLayout />,
    children: [
      { index: true, element: <CandidatesPage /> },
      { path: "list", element: <PeopleListPage /> },
      { path: "list/new", element: <PersonNewPage /> },
      { path: "list/:personId", element: <PersonPage /> },
      { path: "import", element: <ImportPage /> },
      { path: "events", element: <EventsPage /> },
      { path: "events/new", element: <EventNewPage /> },
      { path: "events/:eventId", element: <EventPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
];

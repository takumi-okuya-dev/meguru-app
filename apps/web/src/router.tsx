// ルートとガード（contracts/ui-routes.md「ルート」「遷移の規則」）
import { createBrowserRouter } from "react-router";
import { RequireAuth } from "@/components/guards";
import { AccountLayout } from "@/pages/account-layout";
import { AccountHome } from "@/pages/account-home";
import { AccountNew } from "@/pages/account-new";
import { AccountSettings } from "@/pages/account-settings";
import { DataDeletion } from "@/pages/data-deletion";
import { Landing } from "@/pages/landing";
import { NotFound } from "@/pages/not-found";
import { SignInPage } from "@/pages/sign-in";

export const routes = [
  { path: "/sign-in/*", element: <SignInPage /> },
  { path: "/data-deletion/:code", element: <DataDeletion /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/accounts/new", element: <AccountNew /> },
      {
        path: "/accounts/:accountId",
        element: <AccountLayout />,
        children: [
          { index: true, element: <AccountHome /> },
          { path: "settings", element: <AccountSettings /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);

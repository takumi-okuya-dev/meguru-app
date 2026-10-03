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
import { AccountSettingsPage } from "@/pages/settings/account";
import { AppearanceSettings } from "@/pages/settings/appearance";
import { SettingsIndex, SettingsLayout } from "@/pages/settings/settings-layout";
import { StrategyPage } from "@/pages/strategy";

/** 画面のルート（contracts/ui-routes.md「ルート」）。認証が必要な画面は RequireAuth で包む。 */
export const routes = [
  { path: "/sign-in/*", element: <SignInPage /> },
  { path: "/data-deletion/:code", element: <DataDeletion /> },
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
      {
        path: "/accounts/:accountId",
        element: <AccountLayout />,
        children: [
          { index: true, element: <AccountHome /> },
          { path: "settings", element: <AccountSettings /> },
          { path: "strategy", element: <StrategyPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

/** アプリのルーター。 */
export const router = createBrowserRouter(routes);

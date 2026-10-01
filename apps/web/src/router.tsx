// ルートとガード（contracts/ui-routes.md「ルート」「遷移の規則」）
import { useAuth } from "@clerk/react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AccountLayout } from "@/pages/account-layout";
import { AccountHome } from "@/pages/account-home";
import { AccountNew } from "@/pages/account-new";
import { AccountSettings } from "@/pages/account-settings";
import { DataDeletion } from "@/pages/data-deletion";
import { Landing } from "@/pages/landing";
import { NotFound } from "@/pages/not-found";
import { SignInPage } from "@/pages/sign-in";

/** 読み込み中は骨組みだけを表示し、データは出さない（規則1） */
export function LoadingSkeleton() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true">
      <div className="h-2 w-24 animate-pulse rounded bg-muted" />
    </div>
  );
}

/** 未ログインのガード：内容を描画する前に /sign-in へ置き換え遷移する（FR-003、規則1） */
export function RequireAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingSkeleton />;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <Outlet />;
}

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

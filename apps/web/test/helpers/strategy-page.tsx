// 課題の画面のテストの組み立て（specs/014 の課題の画面のテストで共有する）。
// api-client の差し替え（vi.mock）は、各テストのファイルで行う。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { emptyStrategyValues, type AccountSummary, type Strategy } from "@meguru/shared";
import type { ComponentType, ReactNode } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";

/** テストのアカウント。 */
export const testAccount: AccountSummary = {
  id: "a1",
  name: "たくみ",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};

/**
 * 保存済みの課題を作る。
 * @param overrides - 上書きする値
 * @returns 課題
 */
export function strategyOf(overrides: Partial<Strategy> = {}): Strategy {
  return {
    ...emptyStrategyValues(),
    version: 1,
    filledCount: 0,
    totalCount: 16,
    updatedAt: "2026-10-03T00:00:00.000Z",
    canEdit: true,
    ...overrides,
  };
}

/**
 * 課題の画面を描く。
 * @param Page - StrategyPage
 * @param Provider - UnsavedChangesProvider
 * @param initialEntry - 開くURL
 * @returns ルーター
 */
export function renderStrategyPage(
  Page: ComponentType,
  Provider: ComponentType<{ children: ReactNode }>,
  initialEntry = "/threads/accounts/a1/strategy",
) {
  const router = createMemoryRouter(
    [
      {
        path: "/threads/accounts/:accountId",
        element: (
          <>
            <Link to="/threads/accounts/a1">ホームへ</Link>
            <Provider>
              <Outlet context={{ account: testAccount }} />
            </Provider>
          </>
        ),
        children: [
          { index: true, element: <p>ホームの中身</p> },
          { path: "strategy", element: <Page /> },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

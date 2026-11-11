// リサーチの画面のテストの組み立て（specs/014。api-client の差し替えは各テストのファイルで行う）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReferencePost } from "@meguru/shared";
import type { ComponentType } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesProvider";
import { testAccount } from "./strategy-page";

const meta = { version: 1, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" };

/**
 * 参考投稿の見本を作る。
 * @param over - 上書きする値
 * @returns 参考投稿
 */
export function refPost(over: Partial<ReferencePost> = {}): ReferencePost {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    body: "伸びていた投稿の本文",
    keyword: "",
    postUrl: "",
    whyGood: "",
    platform: "threads",
    postedDateMode: "unknown",
    postedDate: null,
    metrics: { likes: null, replies: null, views: null, saves: null, reposts: null, followers: null },
    author: "",
    memo: "",
    freshness: "unknown",
    shortId: "00000000",
    ...meta,
    ...over,
  };
}

/**
 * リサーチの画面を描く。
 * @param Page - ResearchPage
 * @param path - 開くURL
 * @returns ルーター
 */
export function renderResearchPage(Page: ComponentType, path = "/accounts/a1/research") {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        // 未保存の変更の確認を確かめられるように、ホームへのリンクと登録先を置く（specs/014 PR #17 のCodexレビュー）
        element: (
          <UnsavedChangesProvider>
            <Link to="/accounts/a1">ホームへ</Link>
            <Outlet context={{ account: testAccount }} />
          </UnsavedChangesProvider>
        ),
        children: [
          { index: true, element: <p>ホームの中身</p> },
          { path: "research", element: <Page /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// US3：リサーチの画面（specs/002 FR-012〜FR-015、contracts/ui-routes.md「リサーチの画面」・規則10）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listReferencePosts = vi.fn();
const listResearchKeywords = vi.fn();
const createReferencePost = vi.fn();
const createResearchKeyword = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, listReferencePosts, listResearchKeywords, createReferencePost, createResearchKeyword },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { ResearchPage } = await import("@/pages/research");

const account: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
};

const meta = { version: 1, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" };

function renderPage(path = "/accounts/a1/research") {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: <Outlet context={{ account }} />,
        children: [{ path: "research", element: <ResearchPage /> }],
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

describe("リサーチの画面", () => {
  beforeEach(() => {
    listReferencePosts.mockResolvedValue({
      items: [{ id: "r1", body: "伸びていた投稿の本文", keyword: "AI", postUrl: "", whyGood: "", ...meta }],
      limit: 200,
      canEdit: true,
    });
    listResearchKeywords.mockResolvedValue({
      items: [{ id: "k1", keyword: "AI", purpose: "初心者向け", ...meta }],
      limit: 100,
      canEdit: true,
    });
    createReferencePost.mockReset();
    createResearchKeyword.mockReset();
  });

  it("参考投稿の「なぜ良いか」が未入力なら「なぜ良いか：未入力」と出る（FR-013）", async () => {
    renderPage();
    expect(await screen.findByText("伸びていた投稿の本文")).toBeInTheDocument();
    expect(screen.getByText("なぜ良いか：未入力")).toBeInTheDocument();
  });

  it("タブの切り替えがクエリ ?tab=keywords に残る", async () => {
    const router = renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "キーワード" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=keywords"));
    expect(await screen.findByText("初心者向け")).toBeInTheDocument();
  });

  it("重複したキーワードを入力すると、保存する前に「同じキーワードがすでに登録されています」が出る（FR-014）", async () => {
    renderPage("/accounts/a1/research?tab=keywords");
    await userEvent.click(await screen.findByRole("button", { name: /キーワードを追加/ }));
    await userEvent.type(await screen.findByRole("textbox", { name: "キーワード" }), "ＡＩ");
    expect(screen.getByText("同じキーワードがすでに登録されています")).toBeInTheDocument();
    expect(createResearchKeyword).not.toHaveBeenCalled();
  });

  it("保存で 403 を受けると、入力内容を残したまま案内のダイアログが出る", async () => {
    createReferencePost.mockRejectedValue(new ApiError("GROWER_FEATURE_REQUIRED", 403));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /参考投稿を追加/ }));
    const body = await screen.findByLabelText("本文");
    await userEvent.type(body, "新しい投稿");
    await userEvent.click(screen.getAllByRole("button", { name: "保存" })[0]!);
    expect(await screen.findByText("編集できなくなりました")).toBeInTheDocument();
    expect(screen.getByLabelText("本文")).toHaveValue("新しい投稿");
  });
});

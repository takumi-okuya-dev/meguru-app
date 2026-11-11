// US3：リサーチの画面（specs/002 FR-012〜FR-015、contracts/ui-routes.md「リサーチの画面」・規則10）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary } from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listReferencePosts = vi.fn();
const listResearchKeywords = vi.fn();
const createReferencePost = vi.fn();
const createReferencePostsBatch = vi.fn();
const createResearchKeyword = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, listReferencePosts, listResearchKeywords, createReferencePost, createReferencePostsBatch, createResearchKeyword },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { refPost } = await import("./helpers/research");
const { ResearchPage } = await import("@/pages/research");

const account: AccountSummary = {
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
      items: [refPost({ id: "r1", body: "伸びていた投稿の本文", keyword: "AI" })],
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
    createReferencePostsBatch.mockRejectedValue(new ApiError("BILLING_REQUIRED", 403, ["trial_ended"]));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /参考投稿を追加/ }));
    const body = await screen.findByLabelText(/^本文/);
    await userEvent.type(body, "新しい投稿");
    await userEvent.click(screen.getAllByRole("button", { name: "登録する" })[0]!);
    expect(await screen.findByText("編集できなくなりました")).toBeInTheDocument();
    expect(screen.getByLabelText(/^本文/)).toHaveValue("新しい投稿");
    // 案内を閉じても、ダイアログは閉じずに入力内容を読むだけで残す（Codexレビュー P1）
    const notice = screen.getByRole("dialog", { name: "編集できなくなりました" });
    await userEvent.click(within(notice).getAllByRole("button", { name: "閉じる" })[0]!);
    await waitFor(() => expect(screen.queryByText("編集できなくなりました")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^本文/)).toHaveValue("新しい投稿");
    expect(screen.getByLabelText(/^本文/)).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "登録する" })).not.toBeInTheDocument();
  });

  it("保存の途中は入力欄を読み取り専用にする（送った内容と食い違わないように。Codexレビュー P1）", async () => {
    createReferencePostsBatch.mockReturnValue(new Promise(() => {}));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /参考投稿を追加/ }));
    await userEvent.type(await screen.findByLabelText(/^本文/), "新しい投稿");
    await userEvent.click(screen.getAllByRole("button", { name: "登録する" })[0]!);
    await waitFor(() => expect(screen.getByLabelText(/^本文/)).toHaveAttribute("readonly"));
  });

  it("追加で件数の上限（409 ITEM_LIMIT_REACHED）を受けたら、一覧を読み込み直す（Codexレビュー P2）", async () => {
    createReferencePostsBatch.mockRejectedValue(new ApiError("ITEM_LIMIT_REACHED", 409));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /参考投稿を追加/ }));
    await userEvent.type(await screen.findByLabelText(/^本文/), "新しい投稿");
    const before = listReferencePosts.mock.calls.length;
    await userEvent.click(screen.getAllByRole("button", { name: "登録する" })[0]!);
    await waitFor(() => expect(listReferencePosts.mock.calls.length).toBeGreaterThan(before));
  });
});

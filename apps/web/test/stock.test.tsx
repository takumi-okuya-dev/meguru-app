// 投稿ストックの画面（specs/003-prompt-bulk-register US1〜US3、contracts/ui-routes.md「投稿ストックの画面」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, PostDraft, PromptResponse } from "@threads-grower/shared";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
const putPromptSettings = vi.fn();
const createDraftBatch = vi.fn();
const deleteDraftBatch = vi.fn();
const updatePostDraft = vi.fn();
const deletePostDrafts = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listPostDrafts,
      getPrompt,
      putPromptSettings,
      createDraftBatch,
      deleteDraftBatch,
      updatePostDraft,
      deletePostDrafts,
    },
  };
});
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StockPage } = await import("@/pages/stock");

const account: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
};

const PROMPT = "以下の情報をもとに、Threadsに投稿する文章を30件作ってください。";

function promptResponse(overrides: Partial<PromptResponse["summary"]> = {}, count = 30): PromptResponse {
  return {
    prompt: count === 30 ? PROMPT : `${count}件のプロンプト`,
    count,
    summary: { strategyFilledCount: 11, promotionCount: 1, referencePostCount: 3, recentDraftCount: 0, length: 100, ...overrides },
  };
}

function listResponse(overrides: { items?: PostDraft[]; canGeneratePrompt?: boolean; promptPostCount?: number } = {}) {
  return { items: [], limit: 500, canGeneratePrompt: true, promptPostCount: 30, ...overrides };
}

function renderPage(path = "/accounts/a1/stock") {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <>
            <Link to="/accounts/a1">ホームへ</Link>
            <Link to="/accounts/a1/stock">投稿ストックへ</Link>
            <UnsavedChangesProvider>
              <Outlet context={{ account }} />
            </UnsavedChangesProvider>
          </>
        ),
        children: [
          { index: true, element: <p>ホームの中身</p> },
          { path: "strategy", element: <p>課題の中身</p> },
          { path: "stock", element: <StockPage /> },
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

beforeEach(() => {
  for (const fn of [listPostDrafts, getPrompt, putPromptSettings, createDraftBatch, deleteDraftBatch, updatePostDraft, deletePostDrafts]) {
    fn.mockReset();
  }
  toastSuccess.mockReset();
  listPostDrafts.mockResolvedValue(listResponse());
  getPrompt.mockImplementation((_id: string, count?: number) => Promise.resolve(promptResponse({}, count ?? 30)));
});

describe("プロンプトのカード（US1）", () => {
  it("要約が出て、「コピー」で全文がクリップボードに渡り、トーストが出る", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage();
    expect(await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(toastSuccess).toHaveBeenCalledWith("コピーしました。ChatGPTやClaudeに貼り付けて送ってください");
  });

  it("コピーの失敗：全文の欄が開いて全選択され、案内が出る（research.md R13）", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(await screen.findByText("自動でコピーできませんでした。選択された文字を手でコピーしてください")).toBeInTheDocument();
    const area = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "プロンプトの全文" });
    await waitFor(() => expect([area.selectionStart, area.selectionEnd]).toEqual([0, PROMPT.length]));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("「プロンプトを見る」で書き換えると、書き換えた内容をコピーする。「元に戻す」で元に戻る（FR-005）", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await user.click(screen.getByRole("button", { name: "プロンプトを見る" }));
    const area = screen.getByRole("textbox", { name: "プロンプトの全文" });
    expect(area).toHaveValue(PROMPT);
    await user.clear(area);
    await user.type(area, "書き換えた");
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(writeText).toHaveBeenLastCalledWith("書き換えた");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(area).toHaveValue(PROMPT);
  });

  it("作る件数を変えると、0.5秒後に保存してその件数のプロンプトを取り直す（FR-004）", async () => {
    const user = userEvent.setup();
    putPromptSettings.mockResolvedValue({ postCount: 10 });
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    expect(input).toHaveValue(30);
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10), { timeout: 2000 });
    expect(putPromptSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getPrompt).toHaveBeenCalledWith("a1", 10));
  });

  it("作る件数が範囲外なら保存しない", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "51");
    expect(await screen.findByText("1〜50の整数で入力してください")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(putPromptSettings).not.toHaveBeenCalled();
  });

  it("プラン1の表示：canGeneratePrompt が false なら案内に変わり、getPrompt を呼ばない（FR-024）", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    renderPage();
    expect(await screen.findByText("AIプロンプトの生成はプラン2以上で使えます")).toBeInTheDocument();
    expect(screen.getByText(/「@@@」だけの行で区切って下の欄に貼り付ければ、まとめて登録できます/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "コピー" })).not.toBeInTheDocument();
    expect(getPrompt).not.toHaveBeenCalled();
  });

  it("課題が0項目なら、要約の代わりに課題の画面への案内が出る（FR-006）", async () => {
    const user = userEvent.setup();
    getPrompt.mockResolvedValue(promptResponse({ strategyFilledCount: 0 }));
    const router = renderPage();
    expect(await screen.findByText("課題を入力すると、投稿の精度が上がります")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "課題を入力する" }));
    expect(router.state.location.pathname).toBe("/accounts/a1/strategy");
  });

  it("プロンプトの取得に失敗したら、カードの中に原因と「再読み込み」を出す", async () => {
    const user = userEvent.setup();
    getPrompt.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    renderPage();
    const retry = await screen.findByRole("button", { name: "再読み込み" });
    expect(screen.getByRole("heading", { name: "投稿ストック" })).toBeInTheDocument();
    await user.click(retry);
    expect(await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映")).toBeInTheDocument();
  });

  it("投稿ストックの画面を開くたびに、プロンプトを取り直す（FR-007）", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    expect(getPrompt).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    await screen.findByText("ホームの中身");
    await user.click(screen.getByRole("link", { name: "投稿ストックへ" }));
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await waitFor(() => expect(getPrompt).toHaveBeenCalledTimes(2));
  });
});

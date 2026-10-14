// US1：課題の画面（specs/002 FR-018〜FR-020・FR-024a、contracts/ui-routes.md 規則2〜5・10）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyStrategyValues, type AccountSummary, type Strategy } from "@threads-grower/shared";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStrategy = vi.fn();
const putStrategy = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, getStrategy, putStrategy } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StrategyPage } = await import("@/pages/strategy");

const account: AccountSummary = {
  id: "a1",
  name: "たくみ",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};

function strategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    ...emptyStrategyValues(),
    finalAction: "保存済みの行動",
    version: 1,
    filledCount: 1,
    totalCount: 16,
    updatedAt: "2026-10-03T00:00:00.000Z",
    canEdit: true,
    ...overrides,
  };
}

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <>
            <Link to="/accounts/a1">ホームへ</Link>
            <UnsavedChangesProvider>
              <Outlet context={{ account }} />
            </UnsavedChangesProvider>
          </>
        ),
        children: [
          { index: true, element: <p>ホームの中身</p> },
          { path: "strategy", element: <StrategyPage /> },
        ],
      },
    ],
    { initialEntries: ["/accounts/a1/strategy"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const fieldLabel = "最終的に読者に取ってほしい行動";

describe("課題の画面", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("区分の見出しと各項目、入力済み項目数が出る", async () => {
    getStrategy.mockResolvedValue(strategy());
    renderPage();
    expect(await screen.findByLabelText(fieldLabel)).toHaveValue("保存済みの行動");
    expect(screen.getByRole("heading", { name: "課題① 営業導線設計" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "プロフィール・固定投稿（下書き）" })).toBeInTheDocument();
    expect(screen.getAllByText("1/16 入力済み").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("近い人間性")).toBeInTheDocument();
  });

  describe("未保存の警告（FR-019）", () => {
    it("編集して保存せずに移動すると確認が出て、「編集に戻る」で入力内容が残る", async () => {
      getStrategy.mockResolvedValue(strategy());
      const router = renderPage();
      const field = await screen.findByLabelText(fieldLabel);
      await userEvent.type(field, "を追記");
      await userEvent.click(screen.getByRole("link", { name: "ホームへ" }));
      expect(await screen.findByText("保存していない変更があります")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "編集に戻る" }));
      expect(router.state.location.pathname).toBe("/accounts/a1/strategy");
      expect(screen.getByLabelText(fieldLabel)).toHaveValue("保存済みの行動を追記");
    });

    it("「変更を破棄して移動」で移動する", async () => {
      getStrategy.mockResolvedValue(strategy());
      const router = renderPage();
      await userEvent.type(await screen.findByLabelText(fieldLabel), "x");
      await userEvent.click(screen.getByRole("link", { name: "ホームへ" }));
      await userEvent.click(await screen.findByRole("button", { name: "変更を破棄して移動" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/accounts/a1"));
    });

    it("入力して元に戻した場合は、確認を出さずに移動する", async () => {
      getStrategy.mockResolvedValue(strategy());
      const router = renderPage();
      const field = await screen.findByLabelText(fieldLabel);
      await userEvent.type(field, "x");
      await userEvent.type(field, "{backspace}");
      await userEvent.click(screen.getByRole("link", { name: "ホームへ" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/accounts/a1"));
      expect(screen.queryByText("保存していない変更があります")).not.toBeInTheDocument();
    });
  });

  it("保存の途中で続けて入力した内容は、保存の完了時に消えず、未保存の変更として残る（Codexレビュー P1）", async () => {
    getStrategy.mockResolvedValue(strategy());
    let resolve!: (s: Strategy) => void;
    putStrategy.mockReturnValue(new Promise<Strategy>((r) => (resolve = r)));
    renderPage();
    const field = await screen.findByLabelText(fieldLabel);
    await userEvent.type(field, "A");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    // 保存の応答を待つ間に、さらに入力する
    await userEvent.type(field, "B");
    resolve(strategy({ finalAction: "保存済みの行動A", version: 2 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    expect(screen.getByLabelText(fieldLabel)).toHaveValue("保存済みの行動AB");
    expect(putStrategy.mock.calls[0]![1]).toMatchObject({ finalAction: "保存済みの行動A", expectedVersion: 1 });
  });

  describe("競合のダイアログ（FR-020）", () => {
    it("409 を受けると「他の場所で更新されています」が出て、「読み込み直す」で最新の値が出る", async () => {
      getStrategy.mockResolvedValue(strategy());
      const latest = strategy({ finalAction: "別のタブの内容", version: 2 });
      putStrategy.mockRejectedValue(new ApiError("STALE_UPDATE", 409, [], latest));
      renderPage();
      await userEvent.type(await screen.findByLabelText(fieldLabel), "x");
      await userEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("他の場所で更新されています")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "最新の内容を読み込み直す" }));
      await waitFor(() => expect(screen.getByLabelText(fieldLabel)).toHaveValue("別のタブの内容"));
    });

    it("「自分の内容で上書きする」で、最新の version を付けて保存し直す", async () => {
      getStrategy.mockResolvedValue(strategy());
      const latest = strategy({ finalAction: "別のタブの内容", version: 2 });
      putStrategy
        .mockRejectedValueOnce(new ApiError("STALE_UPDATE", 409, [], latest))
        .mockResolvedValueOnce(strategy({ finalAction: "保存済みの行動x", version: 3 }));
      renderPage();
      await userEvent.type(await screen.findByLabelText(fieldLabel), "x");
      await userEvent.click(screen.getByRole("button", { name: "保存" }));
      await userEvent.click(await screen.findByRole("button", { name: "自分の内容で上書きする" }));
      await waitFor(() => expect(putStrategy).toHaveBeenCalledTimes(2));
      expect(putStrategy.mock.calls[1]![1]).toMatchObject({ finalAction: "保存済みの行動x", expectedVersion: 2 });
      await waitFor(() => expect(screen.getByLabelText(fieldLabel)).toHaveValue("保存済みの行動x"));
    });
  });

  describe("grower機能を使えないAccount（FR-024a）", () => {
    it("canEdit: false では入力欄が読み取り専用で、保存がなく、案内が出る", async () => {
      getStrategy.mockResolvedValue(strategy({ canEdit: false }));
      renderPage();
      expect(await screen.findByLabelText(fieldLabel)).toHaveAttribute("readonly");
      expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
      expect(screen.getByText(/プラン2以上で使えます/)).toBeInTheDocument();
    });

    it("保存で 403 を受けると、入力内容を残したまま案内のダイアログが出る", async () => {
      getStrategy.mockResolvedValue(strategy());
      putStrategy.mockRejectedValue(new ApiError("GROWER_FEATURE_REQUIRED", 403));
      renderPage();
      await userEvent.type(await screen.findByLabelText(fieldLabel), "x");
      await userEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("編集できなくなりました")).toBeInTheDocument();
      expect(screen.getByLabelText(fieldLabel)).toHaveValue("保存済みの行動x");
    });
  });
});

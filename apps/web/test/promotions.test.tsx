// US2：宣伝内容の画面（Codexレビューへの対応：状態の変更の競合、宣伝投稿の割合の未保存の警告）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, Promotion } from "@threads-grower/shared";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listPromotions = vi.fn();
const updatePromotion = vi.fn();
const getPromotionSettings = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, listPromotions, updatePromotion, getPromotionSettings } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { PromotionsPage } = await import("@/pages/promotions");

const account: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
};

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: "p1",
    title: "10月11日 IT交流会",
    content: "交流飲み会です",
    targetLocation: "",
    targetPersona: "",
    targetAgeRange: "",
    cta: "",
    linkedUrl: "",
    priority: 0,
    status: "active",
    validUntil: null,
    isExpired: false,
    isTargetable: true,
    version: 1,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
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
          { path: "promotions", element: <PromotionsPage /> },
        ],
      },
    ],
    { initialEntries: ["/accounts/a1/promotions"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("宣伝内容の画面", () => {
  beforeEach(() => {
    listPromotions.mockResolvedValue({ items: [promotion()], limit: 50, canEdit: true });
    getPromotionSettings.mockResolvedValue({ ratioPercent: 20, canEdit: true });
    updatePromotion.mockReset();
  });

  it("メニューからの状態の変更が他で先に更新されていたら、選択のダイアログを出し、「上書き」で最新の version に選んだ状態を当てて保存し直す（Codexレビュー P2）", async () => {
    const latest = promotion({ title: "別のタブで変えたタイトル", version: 2 });
    updatePromotion
      .mockRejectedValueOnce(new ApiError("STALE_UPDATE", 409, [], latest))
      .mockResolvedValueOnce(promotion({ ...latest, status: "paused", version: 3 }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "10月11日 IT交流会の操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "一時停止" }));
    expect(await screen.findByText("他の場所で更新されています")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "自分の内容で上書きする" }));
    await waitFor(() => expect(updatePromotion).toHaveBeenCalledTimes(2));
    expect(updatePromotion.mock.calls[1]![2]).toMatchObject({
      title: "別のタブで変えたタイトル",
      status: "paused",
      expectedVersion: 2,
    });
  });

  it("宣伝投稿の割合を変えて保存せずに移動すると、確認が出る（FR-019、Codexレビュー P2）", async () => {
    const router = renderPage();
    const ratio = await screen.findByLabelText("宣伝投稿の割合");
    await waitFor(() => expect(ratio).toHaveValue(20));
    await userEvent.clear(ratio);
    await userEvent.type(ratio, "30");
    await userEvent.click(screen.getByRole("link", { name: "ホームへ" }));
    expect(await screen.findByText("保存していない変更があります")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "編集に戻る" }));
    expect(router.state.location.pathname).toBe("/accounts/a1/promotions");
    expect(screen.getByLabelText("宣伝投稿の割合")).toHaveValue(30);
  });
});

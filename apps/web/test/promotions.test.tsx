// US2：宣伝内容の画面（Codexレビューへの対応：状態の変更の競合、宣伝投稿の割合の未保存の警告）
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, Promotion } from "@threads-grower/shared";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listPromotions = vi.fn();
const updatePromotion = vi.fn();
const getPromotionSettings = vi.fn();
const putPromotionSettings = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, listPromotions, updatePromotion, getPromotionSettings, putPromotionSettings } };
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
  role: "owner" as const,
  ownerName: null,
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
    getPromotionSettings.mockResolvedValue({ ratioPercent: 20, version: 1, canEdit: true });
    updatePromotion.mockReset();
    putPromotionSettings.mockReset();
  });

  it("宣伝投稿の割合を先に他の人が保存していたら、名前つきのダイアログを出し、「上書き」で最新の版を送る（specs/008 FR-007、PR #9 のCodexレビュー）", async () => {
    putPromotionSettings
      .mockRejectedValueOnce(new ApiError("STALE_UPDATE", 409, [], { ratioPercent: 40, version: 2, canEdit: true }, { name: "田中 健" }))
      .mockResolvedValueOnce({ ratioPercent: 30, version: 3, canEdit: true });
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "宣伝投稿の割合" });
    await waitFor(() => expect(input).toHaveValue(20));
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(putPromotionSettings).toHaveBeenLastCalledWith("a1", 30, 1);
    expect(await screen.findByText("田中 健さんが先に保存しました")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "自分の内容で上書きする" }));
    await waitFor(() => expect(putPromotionSettings).toHaveBeenLastCalledWith("a1", 30, 2));
  });

  it("編集中に裏で読み直して版が上がっても、編集を始めたときの版で保存する（PR #9 のCodexレビュー4回目）", async () => {
    getPromotionSettings
      .mockResolvedValueOnce({ ratioPercent: 20, version: 1, canEdit: true })
      .mockResolvedValue({ ratioPercent: 40, version: 2, canEdit: true });
    putPromotionSettings.mockRejectedValueOnce(
      new ApiError("STALE_UPDATE", 409, [], { ratioPercent: 40, version: 2, canEdit: true }, { name: "田中 健" }),
    );
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "宣伝投稿の割合" });
    await waitFor(() => expect(input).toHaveValue(20));
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    // 通信の復帰などで裏で読み直す
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(getPromotionSettings.mock.calls.length).toBeGreaterThan(1));
    expect(input).toHaveValue(30);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(putPromotionSettings).toHaveBeenLastCalledWith("a1", 30, 1);
    expect(await screen.findByText("田中 健さんが先に保存しました")).toBeInTheDocument();
    focusManager.setFocused(undefined);
  });

  it("宣伝投稿の割合の競合で「最新の内容を読み込み直す」を選ぶと、先に保存された値を出す", async () => {
    putPromotionSettings.mockRejectedValueOnce(
      new ApiError("STALE_UPDATE", 409, [], { ratioPercent: 40, version: 2, canEdit: true }, { name: "田中 健" }),
    );
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "宣伝投稿の割合" });
    await waitFor(() => expect(input).toHaveValue(20));
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await userEvent.click(await screen.findByRole("button", { name: "最新の内容を読み込み直す" }));
    await waitFor(() => expect(input).toHaveValue(40));
    expect(putPromotionSettings).toHaveBeenCalledTimes(1);
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

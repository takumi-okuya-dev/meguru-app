// US4：Accountのホーム（specs/002 FR-017・FR-024b、contracts/ui-routes.md「ホーム」、research.md R11）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { AccountSummary, ProfileStatus } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

let current: ProfileStatus;
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, getProfileStatus: () => Promise.resolve(current) } };
});

const { AccountHome } = await import("@/pages/account-home");

const account: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-only",
  connectionStatus: "connected",
  lastUsedAt: null,
};

function status(overrides: Partial<ProfileStatus> = {}): ProfileStatus {
  return {
    strategy: { filledCount: 0, totalCount: 16 },
    promotions: { targetableCount: 0, totalCount: 0 },
    research: { referencePostCount: 0, keywordCount: 0 },
    access: { canEdit: true, inTrial: true, trialEndsAt: "2026-11-03T03:00:00.000Z" },
    ...overrides,
  };
}

function renderHome(s: ProfileStatus) {
  current = s;
  const router = createMemoryRouter(
    [{ path: "/accounts/:accountId", element: <Outlet context={{ account }} />, children: [{ index: true, element: <AccountHome /> }] }],
    { initialEntries: ["/accounts/a1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("Accountのホーム", () => {
  it("何も入力していなければ「まずは「課題」から埋めましょう」と3枚のカードが出る", async () => {
    renderHome(status());
    expect(await screen.findByRole("heading", { name: "まずは「課題」から埋めましょう" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /課題.*0\/16 入力済み/ })).toHaveAttribute("href", "/accounts/a1/strategy");
    expect(screen.getByRole("link", { name: /宣伝内容.*宣伝の対象 0件/ })).toHaveAttribute("href", "/accounts/a1/promotions");
    expect(screen.getByRole("link", { name: /リサーチ.*参考投稿 0件/ })).toHaveAttribute("href", "/accounts/a1/research");
  });

  it("課題だけ入力済みなら「次は「宣伝内容」を登録しましょう」", async () => {
    renderHome(status({ strategy: { filledCount: 8, totalCount: 16 } }));
    expect(await screen.findByRole("heading", { name: "次は「宣伝内容」を登録しましょう" })).toBeInTheDocument();
  });

  it("宣伝内容もあれば「次は「リサーチ」がおすすめです」、全部あれば「投稿の材料がそろっています」", async () => {
    renderHome(status({ strategy: { filledCount: 8, totalCount: 16 }, promotions: { targetableCount: 0, totalCount: 1 } }));
    expect(await screen.findByRole("heading", { name: "次は「リサーチ」がおすすめです" })).toBeInTheDocument();
  });

  it("全部あれば「投稿の材料がそろっています」", async () => {
    renderHome(
      status({
        strategy: { filledCount: 16, totalCount: 16 },
        promotions: { targetableCount: 1, totalCount: 1 },
        research: { referencePostCount: 3, keywordCount: 0 },
      }),
    );
    expect(await screen.findByRole("heading", { name: "投稿の材料がそろっています" })).toBeInTheDocument();
  });

  it("無料体験中は「無料体験中：{YYYY年M月D日}まで、すべての機能を使えます」が出る（FR-024b）", async () => {
    renderHome(status());
    expect(await screen.findByText("無料体験中：2026年11月3日まで、すべての機能を使えます")).toBeInTheDocument();
  });

  it("canEdit: false では、grower機能の案内に変わる", async () => {
    renderHome(status({ access: { canEdit: false, inTrial: false, trialEndsAt: "2026-09-01T00:00:00.000Z" } }));
    expect(
      await screen.findByRole("heading", { name: "課題・宣伝内容・リサーチの編集は、プラン2以上で使えます" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/無料体験中/)).not.toBeInTheDocument();
  });
});

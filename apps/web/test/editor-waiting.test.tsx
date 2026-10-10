// 担当がまだない編集者の待機の案内（specs/008-team-operations FR-026・FR-047(3)）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const me = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me } };
});
const { Landing } = await import("@/pages/landing");

const base: MeResponse = {
  user: { id: "u", email: "sato@example.com", displayName: "佐藤 美咲" },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: 1, used: 0 },
  threadsAccessMode: "testers",
  partnerTeam: null,
  editorWaiting: { partnerName: "田中 健" },
};

function renderAt() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <Landing /> },
      { path: "/accounts/new", element: <p>アカウント追加画面</p> },
      { path: "/accounts/:id", element: <p>担当のAccount</p> },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("待機の案内", () => {
  it("Threadsの接続を求めず、パートナーの名前で案内し、担当が決まった後に読み込み直すと担当のAccountへ移る", async () => {
    me.mockResolvedValueOnce(base).mockResolvedValue({
      ...base,
      accounts: [
        {
          id: "b",
          username: "cafe_b",
          displayName: "カフェ B店",
          profilePictureUrl: null,
          plan: "auto-only",
          connectionStatus: "connected",
          lastUsedAt: null,
          role: "editor",
          ownerName: "鈴木 花子",
        },
      ],
      landingAccountId: "b",
      editorWaiting: null,
    });
    const user = userEvent.setup();
    const router = renderAt();
    expect(await screen.findByText("田中 健さんが担当を決めるのを待っています")).toBeInTheDocument();
    expect(screen.queryByText("アカウント追加画面")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "読み込み直す" }));
    expect(await screen.findByText("担当のAccount")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/accounts/b");
  });
});

// 001の画面の手直し（docs/ui-design.md「8. 001からの変更点」）：Accountの切り替え、サイドバーの開閉、設定の2段表示
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetViewport, setViewport } from "./helpers/viewport";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "Takumi", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

function account(id: string, username: string, connectionStatus: "connected" | "needs_reconnect" = "connected") {
  return { id, username, displayName: username, profilePictureUrl: null, plan: "auto-grower" as const, connectionStatus, lastUsedAt: null };
}
const meResponse: MeResponse = {
  user: { id: "u", email: "t@example.com", displayName: "Takumi" },
  accounts: [account("a1", "takumi"), account("a2", "aibu", "needs_reconnect")],
  landingAccountId: "a1",
  accountLimit: { max: 5, used: 2 },
  threadsAccessMode: "testers",
};
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: () => Promise.resolve(meResponse) } };
});

const { AppShell } = await import("@/components/layout/AppShell");
const { PageHeader } = await import("@/components/layout/PageHeader");
const { SettingsLayout, SettingsIndex } = await import("@/pages/settings/settings-layout");
const { AppearanceSettings } = await import("@/pages/settings/appearance");

function renderShell() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <AppShell>
            <PageHeader title="ホーム" />
            <p>中身</p>
          </AppShell>
        ),
      },
      { path: "/accounts/new", element: <p>アカウント追加画面</p> },
    ],
    { initialEntries: ["/accounts/a1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function renderSettings(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>アプリのホーム</p> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsIndex /> },
          { path: "appearance", element: <AppearanceSettings /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("Accountの切り替え（ドロップダウン）", () => {
  beforeEach(() => setViewport(1440));
  afterEach(() => {
    resetViewport();
    localStorage.clear();
  });

  it("表示中のAccountのボタンからドロップダウンを開くと、一覧と「アカウントを追加」が出て、要再接続のAccountには「要再接続」と出る", async () => {
    renderShell();
    const trigger = await screen.findByRole("button", { name: /Accountを切り替える/ });
    await screen.findByText("@takumi");
    expect(trigger).toHaveTextContent("@takumi");
    await userEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /@takumi/ })).toBeInTheDocument();
    const aibu = screen.getByRole("menuitem", { name: /@aibu/ });
    expect(aibu).toHaveTextContent("要再接続");
    expect(screen.getByRole("menuitem", { name: /アカウントを追加/ })).toBeInTheDocument();
  });
});

describe("サイドバーの開閉", () => {
  afterEach(() => {
    resetViewport();
    localStorage.clear();
  });

  it("1024px以上では畳めて、畳んだ状態が localStorage に保存される", async () => {
    setViewport(1440);
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "サイドバーを閉じる" }));
    expect(localStorage.getItem("tg.sidebarCollapsed")).toBe("1");
    expect(screen.queryByRole("button", { name: /Accountを切り替える/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "サイドバーを開く" }));
    expect(localStorage.getItem("tg.sidebarCollapsed")).toBe("0");
    expect(await screen.findByRole("button", { name: /Accountを切り替える/ })).toBeInTheDocument();
  });

  it("767px以下ではサイドバーを出さず、メニューのボタンでドロワーを開く", async () => {
    setViewport(375);
    renderShell();
    expect(screen.queryByRole("button", { name: /Accountを切り替える/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "メニューを開く" }));
    expect(await screen.findByRole("button", { name: /Accountを切り替える/ })).toBeInTheDocument();
  });
});

describe("設定画面の2段表示（767px以下）", () => {
  afterEach(() => resetViewport());

  it("/settings では項目の一覧だけを出し、項目を選ぶと中身の画面に「← 設定」が出る", async () => {
    setViewport(375);
    const router = renderSettings("/settings");
    expect(router.state.location.pathname).toBe("/settings");
    await userEvent.click(await screen.findByRole("link", { name: /外観/ }));
    expect(await screen.findByRole("heading", { name: "表示スタイル" })).toBeInTheDocument();
    expect(screen.queryByLabelText("設定を検索")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "設定" }));
    expect(router.state.location.pathname).toBe("/settings");
    expect(await screen.findByLabelText("設定を検索")).toBeInTheDocument();
  });

  it("768px以上では、これまでどおり最初の項目へ移る", async () => {
    setViewport(1024);
    const router = renderSettings("/settings");
    expect(await screen.findByRole("heading", { name: "外観" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/appearance");
  });
});

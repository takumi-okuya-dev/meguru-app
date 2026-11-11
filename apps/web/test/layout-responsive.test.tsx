// 001の画面の手直し（docs/ui-design.md「8. 001からの変更点」）：Accountの切り替え、サイドバーの開閉、設定の2段表示
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetViewport, setViewport } from "./helpers/viewport";
import { ME_BILLING_OFF } from "./helpers/billing";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "Takumi", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

function account(id: string, username: string, connectionStatus: "connected" | "needs_reconnect" = "connected") {
  return { id, name: username, username, displayName: username, profilePictureUrl: null, connectionStatus, lastUsedAt: null, role: "owner" as const, ownerName: null };
}
const meResponse: MeResponse = {
  user: { id: "u", email: "t@example.com", displayName: "Takumi" },
  accounts: [account("a1", "takumi"), account("a2", "aibu", "needs_reconnect")],
  landingAccountId: "a1",
  accountLimit: { max: 5, used: 2 },
  ...ME_BILLING_OFF,
  threadsAccessMode: "testers",
  threadsConnectMethods: ["app", "token"] as const,
  teams: [],
};
const getDraftCounts = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  // サイドバーは /access の features（specs/019）を見てから件数を読む
  const { OWNER_ACCESS } = await import("./helpers/access");
  return { ...actual, api: { ...actual.api, me: () => Promise.resolve(meResponse), getDraftCounts, accountAccess: async () => OWNER_ACCESS } };
});

const { ThreadsShell } = await import("@/apps/threads");
const { PageHeader } = await import("@/shell/layout/PageHeader");
const { SettingsLayout, SettingsIndex } = await import("@/shell/settings/settings-layout");
const { AppearanceSettings } = await import("@/shell/settings/appearance");

function renderShell() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <ThreadsShell>
            <PageHeader title="ホーム" />
            <p>中身</p>
          </ThreadsShell>
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
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("Accountの切り替え（ドロップダウン）", () => {
  beforeEach(() => setViewport(1440));
  afterEach(() => {
    resetViewport();
    localStorage.clear();
  });

  it("表示中のAccountのボタンからドロップダウンを開くと、一覧と「アカウントを作る」が出て、要再接続のAccountには「要再接続」と出る", async () => {
    renderShell();
    const trigger = await screen.findByRole("button", { name: /Accountを切り替える/ });
    await screen.findByText("@takumi");
    expect(trigger).toHaveTextContent("@takumi");
    await userEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /@takumi/ })).toBeInTheDocument();
    const aibu = screen.getByRole("menuitem", { name: /@aibu/ });
    expect(aibu).toHaveTextContent("要再接続");
    expect(screen.getByRole("menuitem", { name: /アカウントを作る/ })).toBeInTheDocument();
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

describe("サイドバーの要確認の件数（specs/004 FR-013）", () => {
  beforeEach(() => setViewport(1440));
  afterEach(() => {
    resetViewport();
    getDraftCounts.mockReset();
  });

  it("投稿ストックの右に要確認の件数が出る", async () => {
    getDraftCounts.mockResolvedValue({ needsReview: 12, approved: 3, rejected: 1, published: 40, publishFailed: 2 });
    renderShell();
    expect(await screen.findByRole("link", { name: /^投稿ストック.*（要確認 12件）$/ })).toBeInTheDocument();
    expect(getDraftCounts).toHaveBeenCalledWith("a1");
  });

  it("投稿に失敗・投稿済みの件数は数えない（specs/005-auto-post FR-023）", async () => {
    getDraftCounts.mockResolvedValue({ needsReview: 0, approved: 3, rejected: 1, published: 40, publishFailed: 2 });
    renderShell();
    const link = await screen.findByRole("link", { name: "投稿ストック" });
    await waitFor(() => expect(getDraftCounts).toHaveBeenCalled());
    expect(link).not.toHaveTextContent(/\d/);
  });

  it("0件のときは出さない", async () => {
    getDraftCounts.mockResolvedValue({ needsReview: 0, approved: 3, rejected: 1, published: 40, publishFailed: 2 });
    renderShell();
    expect(await screen.findByRole("link", { name: "投稿ストック" })).toBeInTheDocument();
    await waitFor(() => expect(getDraftCounts).toHaveBeenCalled());
    expect(screen.queryByText(/要確認 \d+件/)).not.toBeInTheDocument();
  });
});

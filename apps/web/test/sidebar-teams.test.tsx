// サイドバーの「チーム」（specs/011-team-revision contracts/ui-routes.md「サイドバー」、US4、T017・T031、FR-050）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountAccessResponse, MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ACCESS, OWNER_ACCESS } from "./helpers/access";
import { resetViewport, setViewport } from "./helpers/viewport";
import { ME_BILLING_OFF } from "./helpers/billing";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "Takumi", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

const account = {
  id: "a1",
  name: "カフェ B店",
  username: "cafe_b",
  displayName: "カフェ B店",
  profilePictureUrl: null,
  connectionStatus: "connected" as const,
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};
let meResponse: MeResponse;
let access: AccountAccessResponse = OWNER_ACCESS;
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: () => Promise.resolve(meResponse),
      getDraftCounts: () => Promise.resolve({ needsReview: 0, approved: 0 }),
      accountAccess: () => Promise.resolve(access),
    },
  };
});

const { AppShell } = await import("@/components/layout/AppShell");
const { PageHeader } = await import("@/components/layout/PageHeader");

function me(teams: MeResponse["teams"]): MeResponse {
  return {
    user: { id: "u", email: "t@example.com", displayName: "Takumi" },
    accounts: [account],
    landingAccountId: "a1",
    accountLimit: { max: 5, used: 1 },
    ...ME_BILLING_OFF,
    threadsAccessMode: "testers",
    threadsConnectMethods: ["app", "token"] as const,
    teams,
  };
}

function renderAt(path: string) {
  const shell = (
    <AppShell>
      <PageHeader title="画面" />
      <p>中身</p>
    </AppShell>
  );
  const router = createMemoryRouter(
    [
      { path: "/accounts/:accountId/*", element: shell },
      { path: "/teams/:teamId/*", element: shell },
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
  setViewport(1440);
  access = OWNER_ACCESS;
  meResponse = me([]);
});
afterEach(() => {
  resetViewport();
  localStorage.clear();
});

describe("サイドバーの「チーム」", () => {
  it("今の構造のまま、「チーム」の見出しの下に入っているチーム（色の四角・名前・人数）を並べ、押すとチームの画面へ", async () => {
    meResponse = me([
      { id: "t1", name: "飲食チーム", memberCount: 5, role: "member" },
      { id: "t2", name: "美容チーム", memberCount: 3, role: "editor" },
    ]);
    const user = userEvent.setup();
    const router = renderAt("/accounts/a1");
    const nav = await screen.findByRole("navigation", { name: "このアカウント" });
    await within(nav).findByRole("link", { name: /美容チーム/ });
    const labels = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent?.replace(/\s+/g, ""));
    // ホーム → 自動投稿（投稿をつくる・投稿ストック・パフォーマンス）→ 戦略 → チーム（specs/019 FR-004）
    expect(labels).toEqual(["ホーム", "投稿をつくる", "投稿ストック", "パフォーマンス", "解析", "課題", "宣伝内容", "外部媒体展開", "リサーチ", "飲飲食チーム5人", "美美容チーム3人"]);
    expect(within(nav).getByText("チーム")).toBeInTheDocument();
    // 管理者でなければ「チームを作る」は出さない（このアカウントの設定から作る）
    expect(within(nav).queryByRole("button", { name: /チームを作る/ })).not.toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: /飲食チーム/ }));
    expect(router.state.location.pathname).toBe("/teams/t1");
  });

  it("今開いているチームは選択の背景（aria-current）。チームの画面でも、機能は最後に使ったAccountへ移れる", async () => {
    meResponse = me([
      { id: "t1", name: "飲食チーム", memberCount: 5, role: "admin" },
      { id: "t2", name: "美容チーム", memberCount: 3, role: "member" },
    ]);
    renderAt("/teams/t2");
    const nav = await screen.findByRole("navigation", { name: "このアカウント" });
    expect(await within(nav).findByRole("link", { name: /美容チーム/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /飲食チーム/ })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: /投稿ストック/ })).toHaveAttribute("href", "/accounts/a1/stock");
  });

  it("どれかのチームの管理者には「チームを作る」を出し、押すとダイアログが開く", async () => {
    meResponse = me([{ id: "t1", name: "飲食チーム", memberCount: 5, role: "admin" }]);
    const user = userEvent.setup();
    renderAt("/accounts/a1");
    await user.click(await screen.findByRole("button", { name: /チームを作る/ }));
    expect(await screen.findByRole("dialog", { name: "チームを作る" })).toBeInTheDocument();
  });

  it("チームの下に、今のAccountで操作の記録を見られる人には「操作の記録」", async () => {
    meResponse = me([{ id: "t1", name: "飲食チーム", memberCount: 5, role: "admin" }]);
    access = ADMIN_ACCESS;
    renderAt("/accounts/a1");
    expect(await screen.findByRole("link", { name: /操作の記録/ })).toHaveAttribute("href", "/accounts/a1/activity");
  });

  it("チームの画面を開いていても、最後に使ったAccountの「操作の記録」は消さない（2026-10-31 スマートフォンで見つかった不具合）", async () => {
    meResponse = me([{ id: "t1", name: "飲食チーム", memberCount: 5, role: "admin" }]);
    access = ADMIN_ACCESS;
    renderAt("/teams/t1");
    expect(await screen.findByRole("link", { name: /操作の記録/ })).toHaveAttribute("href", "/accounts/a1/activity");
  });

  it("チームに入っていない人には、チームのものを何も出さない（原則V）", async () => {
    renderAt("/accounts/a1");
    const nav = await screen.findByRole("navigation", { name: "このアカウント" });
    await within(nav).findByRole("link", { name: /投稿ストック/ });
    expect(within(nav).queryByText("チーム")).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: /チームを作る/ })).not.toBeInTheDocument();
  });

  it("スマートフォン幅（375px）では、引き出しの中に同じ並びでチーム名が出る", async () => {
    setViewport(375);
    meResponse = me([{ id: "t1", name: "飲食チーム", memberCount: 5, role: "member" }]);
    const user = userEvent.setup();
    renderAt("/accounts/a1");
    await user.click(await screen.findByRole("button", { name: "メニューを開く" }));
    const nav = await screen.findByRole("navigation", { name: "このアカウント" });
    expect(await within(nav).findByRole("link", { name: /飲食チーム/ })).toHaveAttribute("href", "/teams/t1");
  });
});

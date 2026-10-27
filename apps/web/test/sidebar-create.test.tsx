// サイドバーの「投稿をつくる」（specs/014-strategy-guidance US15、FR-160、contracts/ui-routes.md「投稿をつくる」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountAccessResponse, MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";
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

describe("サイドバーの「投稿をつくる」", () => {
  it("並び・名前は今のまま。押すと「投稿をつくる」の画面（/create）へ移る", async () => {
    const user = userEvent.setup();
    const router = renderAt("/accounts/a1");
    const nav = await screen.findByRole("navigation", { name: "このアカウント" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent?.replace(/\s+/g, ""));
    expect(labels).toEqual(["投稿をつくる", "ホーム", "投稿ストック", "課題", "宣伝内容", "リサーチ", "パフォーマンス"]);
    const create = within(nav).getByRole("link", { name: "投稿をつくる" });
    expect(create).toHaveAttribute("href", "/accounts/a1/create");
    expect(create).not.toHaveAttribute("aria-current");
    await user.click(create);
    expect(router.state.location.pathname).toBe("/accounts/a1/create");
  });

  it("「投稿をつくる」の画面では「投稿をつくる」が選ばれた見た目で、投稿ストックは選ばれない", async () => {
    renderAt("/accounts/a1/create");
    const nav = await screen.findByRole("navigation", { name: "このアカウント" });
    expect(within(nav).getByRole("link", { name: "投稿をつくる" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /投稿ストック/ })).not.toHaveAttribute("aria-current");
  });

  it("投稿ストックの画面では、投稿ストックが選ばれた見た目で、「投稿をつくる」は選ばれない", async () => {
    renderAt("/accounts/a1/stock");
    const nav = await screen.findByRole("navigation", { name: "このアカウント" });
    expect(within(nav).getByRole("link", { name: /投稿ストック/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "投稿をつくる" })).not.toHaveAttribute("aria-current");
  });
});

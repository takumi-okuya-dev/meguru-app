// アカウントの示し方（specs/012 SC-006、research.md R2、contracts/ui-routes.md「アカウントの示し方」）。
// 未接続のアカウントで「@null」「@undefined」・空の名前が出ず、主の名前がアカウントの名前になることを確かめる。
// ホーム・設定・招待・チームの画面の未接続の場合は、それぞれの画面のテストで確かめる。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

const mocks = vi.hoisted(() => ({ me: vi.fn(), needsReviewCounts: vi.fn() }));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "User", primaryEmailAddress: { emailAddress: "user@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, api: { ...original.api, me: mocks.me } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, needsReviewCounts: mocks.needsReviewCounts } };
});

const { AccountSwitcher } = await import("@/apps/threads/sidebar/AccountSwitcher");
const { AccountAvatar } = await import("@/apps/threads/components/AccountAvatar");

const unconnected: AccountSummary = {
  id: "a1",
  name: "カフェの公式",
  username: null,
  displayName: null,
  profilePictureUrl: null,
  connectionStatus: "not_connected",
  connectionMethod: null,
  lastUsedAt: null,
  role: "owner",
  ownerName: null,
};
const connected: AccountSummary = {
  ...unconnected,
  id: "a2",
  name: "パン屋の公式",
  username: "bakery_e",
  displayName: "Bakery E",
  connectionStatus: "connected",
  connectionMethod: "app",
};
const me: MeResponse = {
  user: { id: "user", email: "user@example.com", displayName: "User" },
  accounts: [unconnected, connected],
  landingAccountId: "a1",
  accountLimit: { max: 5, used: 2 },
  ...ME_BILLING_OFF,
  threadsAccessMode: "testers",
  threadsConnectMethods: ["app", "token"] as const,
  teams: [],
};

beforeEach(() => {
  mocks.me.mockResolvedValue(me);
  mocks.needsReviewCounts.mockResolvedValue({ counts: [] });
});

function renderSwitcher() {
  const router = createMemoryRouter([{ path: "/threads/accounts/:accountId", element: <AccountSwitcher /> }], {
    initialEntries: ["/threads/accounts/a1"],
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("アカウントの示し方（SC-006）", () => {
  it("画像がなければ、アカウントの名前の頭文字を出す", () => {
    render(<AccountAvatar account={unconnected} />);
    expect(screen.getByText("カ")).toBeInTheDocument();
  });

  it("切り替えメニュー：未接続は名前と「未接続」。接続中は名前が主で@ユーザー名を添える。@null は出ない", async () => {
    renderSwitcher();
    const trigger = await screen.findByRole("button", { name: "Accountを切り替える" });
    expect(await within(trigger).findByText("カフェの公式")).toBeInTheDocument();
    expect(within(trigger).getByText("未接続")).toBeInTheDocument();
    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(within(items[0]!).getByText("カフェの公式")).toBeInTheDocument();
    expect(within(items[0]!).getByText("未接続")).toBeInTheDocument();
    expect(within(items[1]!).getByText("パン屋の公式")).toBeInTheDocument();
    expect(within(items[1]!).getByText("@bakery_e")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@null|@undefined/);
  });
});

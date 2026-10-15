// 個人運用（チームに入っていない）のオーナーの画面は、このアカウントの設定のチームの区分の1行
// （「チームに入っていません」「チームを作る」）を除いて008の前と同じ（specs/011 FR-006・SC-005、Constitution 4.0.1 原則V、T038）。
// あわせて、担当の人には立場の表示が出ることを確かめる（T025）。
// specs/012 では、Threadsにつないだアカウントだけを持つ人の画面が、切り替えメニューの「アカウントを作る」と、
// 設定の「アカウントの名前」の区分を除いて変わらないことも確かめる（SC-007、T046）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountAccessResponse, MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ACCESS, EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";
import { ME_BILLING_OFF } from "./helpers/billing";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "Takumi", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

let access: AccountAccessResponse = OWNER_ACCESS;
const meResponse: MeResponse = {
  user: { id: "u", email: "t@example.com", displayName: "Takumi" },
  accounts: [
    {
      id: "a1",
      name: "たくみ",
      username: "takumi",
      displayName: "たくみ",
      profilePictureUrl: null,
      connectionStatus: "connected",
      lastUsedAt: null,
      role: "owner",
      ownerName: null,
    },
  ],
  landingAccountId: "a1",
  accountLimit: { max: 1, used: 1 },
  ...ME_BILLING_OFF,
  threadsAccessMode: "testers",
  teams: [],
};
const accountTeam = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: () => Promise.resolve(meResponse),
      getDraftCounts: () => Promise.resolve({ needsReview: 0, approved: 0 }),
      needsReviewCounts: () => Promise.resolve({ counts: [{ accountId: "a1", needsReview: 0 }] }),
      accountAccess: () => Promise.resolve(access),
      accountTeam,
    },
  };
});

const { Sidebar } = await import("@/components/layout/Sidebar");
const { AssignedNotice } = await import("@/components/team/AssignedNotice");
const { TeamSection } = await import("@/components/team/TeamSection");
const { AccountSwitcher } = await import("@/components/layout/AccountSwitcher");

function renderAt(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/accounts/:accountId", element }], { initialEntries: ["/accounts/a1"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  access = OWNER_ACCESS;
  accountTeam.mockReset();
});

describe("個人運用のオーナー", () => {
  it("サイドバーに立場の表示も「チーム」の見出しも、チームを作る入口も出ない", async () => {
    renderAt(<Sidebar />);
    expect(await screen.findByRole("link", { name: /投稿ストック/ })).toBeInTheDocument();
    expect(screen.queryByText("担当しています")).not.toBeInTheDocument();
    expect(screen.queryByText("チーム")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /チームを作る/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /操作の記録/ })).not.toBeInTheDocument();
  });

  it("ホームに担当の知らせは出ない", async () => {
    renderAt(<AssignedNotice account={meResponse.accounts[0]!} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("このアカウントの設定に増えるのは、チームの区分の1行だけ。チームの問い合わせはしない", async () => {
    renderAt(<TeamSection accountId="a1" access={OWNER_ACCESS} />);
    expect(screen.getByText("チームに入っていません")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["チームを作る"]);
    expect(accountTeam).not.toHaveBeenCalled();
  });
});

describe("担当の人", () => {
  it("編集者には、切り替えの下に「担当しています」とオーナーの名前が出る。操作の記録は出ない", async () => {
    access = EDITOR_ACCESS;
    renderAt(<Sidebar />);
    expect(await screen.findByText("担当しています")).toBeInTheDocument();
    expect(screen.getByText("オーナー：鈴木 花子")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /操作の記録/ })).not.toBeInTheDocument();
  });

  it("自分を担当にした管理者には「チーム > 操作の記録」が出る", async () => {
    access = ADMIN_ACCESS;
    renderAt(<Sidebar />);
    expect(await screen.findByRole("link", { name: /操作の記録/ })).toHaveAttribute("href", "/accounts/a1/activity");
    expect(screen.getByText("担当しています")).toBeInTheDocument();
  });
});

describe("Threadsにつないだアカウントだけの人（specs/012 SC-007）", () => {
  it("切り替えメニューは、名前と@ユーザー名のまま。「未接続」は出ず、入口の文言だけが「アカウントを作る」", async () => {
    renderAt(<AccountSwitcher />);
    const trigger = await screen.findByRole("button", { name: "Accountを切り替える" });
    expect(await within(trigger).findByText("たくみ")).toBeInTheDocument();
    expect(within(trigger).getByText("@takumi")).toBeInTheDocument();
    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("未接続")).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /アカウントを作る/ })).toHaveAttribute("href", "/accounts/new");
  });
});

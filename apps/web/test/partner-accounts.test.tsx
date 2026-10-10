// 手伝っているアカウント・切り替えメニューの見出し（specs/008-team-operations US5、FR-043・FR-061）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { AccountSummary, PartnerSummary } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetViewport, setViewport } from "./helpers/viewport";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "田中 健", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
const getTeamAccounts = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, getTeamAccounts } };
});
const { PartnerAccountsPage } = await import("@/pages/partner/partner-accounts");
const { groupHeading } = await import("@/components/layout/AccountSwitcher");

const summary: PartnerSummary = {
  items: [
    {
      account: { id: "b", displayName: "カフェ B店", username: "cafe_b", profilePictureUrl: null, connectionStatus: "connected" },
      ownerName: "鈴木 花子",
      needsReview: 5,
      approved: { count: 9, days: 3 },
      nextPost: { at: "2026-10-10T08:00:00+09:00", state: "scheduled" },
      judgments7d: { good: 2, normal: 3, poor: 1 },
      delegation: { review: true, settings: false },
      editors: [{ userId: "e1", name: "佐藤 美咲" }],
    },
    {
      account: { id: "d", displayName: "整体院 D", username: "seitai_d", profilePictureUrl: null, connectionStatus: "needs_reconnect" },
      ownerName: "中村 誠",
      needsReview: 3,
      approved: { count: 4, days: null },
      nextPost: { at: null, state: "paused" },
      judgments7d: { good: 0, normal: 2, poor: 2 },
      delegation: { review: false, settings: false },
      editors: [],
    },
  ],
  truncated: false,
};

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/partner/accounts", element: <PartnerAccountsPage /> },
      { path: "/accounts/:id", element: <p>Accountのホーム</p> },
    ],
    { initialEntries: ["/partner/accounts"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => getTeamAccounts.mockReset());
afterEach(() => resetViewport());

describe("手伝っているアカウント", () => {
  it("PCは表で、要確認・承認済み・次の投稿・伸び・任された範囲・担当・要再接続を出す", async () => {
    getTeamAccounts.mockResolvedValue(summary);
    renderPage();
    const table = await screen.findByRole("table");
    expect(screen.getByText("2件 · 要確認の多い順")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("カフェ B店")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("オーナー 鈴木 花子")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("あと3日分")).toBeInTheDocument();
    expect(within(rows[1]!).getByLabelText("伸びた 2件")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("承認")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("佐藤")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("オーナーの再接続待ち")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("投稿を止めています")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("なし", { selector: "span" })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("link", { name: "カフェ B店を開く" })).toHaveAttribute("href", "/accounts/b");
  });

  it("767px以下は1件1枚のカード", async () => {
    setViewport(390);
    getTeamAccounts.mockResolvedValue(summary);
    renderPage();
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("空の状態", async () => {
    getTeamAccounts.mockResolvedValue({ items: [], truncated: false });
    renderPage();
    expect(await screen.findByText(/まだ手伝っているアカウントはありません/)).toBeInTheDocument();
  });
});

describe("切り替えメニューの見出し（groupHeading）", () => {
  const acc = (id: string, role: AccountSummary["role"]): AccountSummary => ({
    id,
    username: id,
    displayName: id,
    profilePictureUrl: null,
    plan: "auto-only",
    connectionStatus: "connected",
    lastUsedAt: null,
    role,
    ownerName: role === "owner" ? null : "鈴木",
  });

  it("手伝っているAccountがなければ見出しを出さない（007と同じ）", () => {
    const list = [acc("a", "owner"), acc("b", "owner")];
    expect(list.map((_, i) => groupHeading(list, i))).toEqual([null, null]);
  });

  it("自分のAccount → 手伝っているAccount の最初の行に見出しを出す", () => {
    const list = [acc("a", "owner"), acc("b", "partner"), acc("c", "editor")];
    expect(list.map((_, i) => groupHeading(list, i))).toEqual(["自分のアカウント", "手伝っているアカウント", null]);
  });

  it("自分のAccountがなければ「手伝っているアカウント」だけ", () => {
    const list = [acc("b", "partner")];
    expect(list.map((_, i) => groupHeading(list, i))).toEqual(["手伝っているアカウント"]);
  });
});

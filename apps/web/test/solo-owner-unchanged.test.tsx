// 個人運用のオーナーの画面は、「運用を手伝ってもらう」の区分以外変わらない（specs/008 FR-006・SC-005、/speckit-analyze G1）。
// あわせて、手伝う人には役割の表示が出ることを確かめる（FR-040）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { AccountAccessResponse, MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";

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
      username: "takumi",
      displayName: "たくみ",
      profilePictureUrl: null,
      plan: "auto-grower",
      connectionStatus: "connected",
      lastUsedAt: null,
      role: "owner",
      ownerName: null,
    },
  ],
  landingAccountId: "a1",
  accountLimit: { max: 1, used: 1 },
  threadsAccessMode: "testers",
  partnerTeam: null,
  editorWaiting: null,
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
      accountAccess: () => Promise.resolve(access),
      accountTeam,
    },
  };
});

const { Sidebar } = await import("@/components/layout/Sidebar");
const { PartnerJoinedNotice } = await import("@/components/team/PartnerJoinedNotice");

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
  it("サイドバーに役割の表示も「チーム」の見出しも出ない", async () => {
    renderAt(<Sidebar />);
    expect(await screen.findByRole("link", { name: /投稿ストック/ })).toBeInTheDocument();
    expect(screen.queryByText("パートナーとして手伝っています")).not.toBeInTheDocument();
    expect(screen.queryByText("編集者として担当しています")).not.toBeInTheDocument();
    expect(screen.queryByText("チーム")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /操作の記録/ })).not.toBeInTheDocument();
  });

  it("パートナーがいなければ、ホームに参加の知らせは出ない", async () => {
    accountTeam.mockResolvedValue({ partner: null, delegation: null, editors: [], joinedNotice: { show: false } });
    renderAt(<PartnerJoinedNotice accountId="a1" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("手伝う人", () => {
  it("編集者には、切り替えの下に役割とオーナーの名前が出る", async () => {
    access = EDITOR_ACCESS;
    renderAt(<Sidebar />);
    expect(await screen.findByText("編集者として担当しています")).toBeInTheDocument();
    expect(screen.getByText("オーナー：鈴木 花子")).toBeInTheDocument();
  });

  it("チームがあるAccountのパートナーには「チーム > 操作の記録」が出る", async () => {
    access = {
      role: "partner",
      permissions: ["view", "content", "activity"],
      owner: { name: "鈴木 花子" },
      hasTeam: true,
      team: { name: "A社", partnerName: "田中 健" },
      delegation: { review: false, settings: false },
    };
    renderAt(<Sidebar />);
    expect(await screen.findByRole("link", { name: /操作の記録/ })).toHaveAttribute("href", "/accounts/a1/activity");
    expect(screen.getByText("パートナーとして手伝っています")).toBeInTheDocument();
  });
});
